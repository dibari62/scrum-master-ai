import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Segreti di terzi, cifrati prima di toccare il database.
 *
 * ADR-0010: la chiave del modello e il token Jira li porta il cliente, e da quel
 * momento sono **roba sua custodita da noi**. Chi li ottiene può spendere i suoi
 * soldi e leggere i suoi progetti.
 *
 * Il database non è un luogo chiuso: ci passano i backup del fornitore, le query
 * di supporto scritte a mano, `npm run db:inspect` e chiunque abbia accesso alla
 * console. Cifrare a riposo significa che **il database da solo non basta**:
 * serve anche `SECRETS_KEY`, che vive nelle variabili d'ambiente. Non rende
 * sicuro un sistema compromesso — alza il costo di una compromissione *parziale*,
 * che è la forma in cui le compromissioni avvengono quasi sempre.
 *
 * ## Le tre scelte che non sono negoziabili
 *
 * **GCM e non CBC.** GCM autentica: un testo cifrato modificato viene *rifiutato*,
 * non decifrato in spazzatura. Senza autenticazione, chi può scrivere sul
 * database può alterare una chiave e nessuno se ne accorge finché non fallisce
 * una chiamata — e a quel punto sembra un guasto del fornitore.
 *
 * **Un vettore di inizializzazione casuale per ogni cifratura.** In GCM riusarlo
 * non indebolisce il testo: **rompe la cifratura**. Con due messaggi sotto lo
 * stesso IV la chiave di autenticazione si ricava, e da lì si può falsificare
 * qualunque testo cifrato. È l'errore più facile da fare e il più costoso.
 *
 * **Nessun ripiego sul chiaro.** Senza `SECRETS_KEY` questo modulo si rifiuta di
 * lavorare. Ripiegare sarebbe come non aver preso la decisione, con in più la
 * convinzione di averla presa.
 */

/**
 * A secret already encrypted, in the form that goes into a column.
 *
 * A distinct type and not `string`, deliberately: a column typed `string` would
 * accept a raw API key, and nothing would complain until the day somebody read a
 * backup. Here the compiler refuses.
 */
export type SealedSecret = string & { readonly __sealed: unique symbol };

/**
 * What can be shown about a secret without showing it.
 *
 * The screen says a key is there, when it was entered and how it ends. Never the
 * key. A form field pre-filled with the secret would be the same leak, written
 * in HTML and sent to a browser.
 */
export type SecretHint = {
  /** The last four characters, the way a card statement names a card. */
  readonly tail: string;
  readonly length: number;
};

/** AES-256 wants 32 bytes; GCM's nonce is 12 by specification. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The version marker, so a future algorithm change can be recognised. */
const PREFIX = "v1";

export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsUnavailableError";
  }
}

export class SecretCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretCorruptedError";
  }
}

/**
 * The master key, read from the environment and validated.
 *
 * Base64 of exactly 32 bytes. Refused rather than padded or hashed into shape: a
 * key silently stretched from a short passphrase looks like a 256-bit key and
 * carries the strength of the passphrase, which is the kind of false comfort
 * this whole module exists to avoid.
 */
/**
 * L'ambiente **del processo**, non quello inciso nel pacchetto compilato.
 *
 * ## Il difetto, e perché il rimedio precedente lo peggiorava
 *
 * Next.js sostituisce a tempo di build le occorrenze **letterali** di
 * `process.env.NOME` con il loro valore. Per la maggior parte delle variabili
 * è innocuo. Non lo è per quelle che **in fase di build non esistono**: su
 * Vercel una variabile di tipo *Secret* è disponibile solo al runtime, quindi
 * il bundler la sostituisce con una **stringa vuota**, e quel vuoto resta
 * inciso nel pacchetto per sempre.
 *
 * Il rimedio precedente raccoglieva riferimenti letterali «perché il bundler
 * li vede». Li vedeva, appunto — e li congelava a vuoto. `SECRETS_KEY`
 * risultava assente a ogni avvio, pur essendo configurata correttamente, e il
 * portale rifiutava di conservare le credenziali dei progetti.
 *
 * **La prova** è arrivata da una contraddizione dentro la pagina di
 * diagnostica: `Object.keys(process.env)` elencava il nome — quindi al runtime
 * la variabile c'è — e la riga accanto lo dava per vuoto. Le uniche due che
 * «funzionavano», `DATABASE_URL` e `AUTH_SECRET`, sono quelle disponibili
 * anche in fase di build.
 *
 * **Costo del difetto**: tre giorni di verifiche su una configurazione che era
 * giusta dall'inizio. È il tipo di guasto peggiore, perché ogni prova conferma
 * l'ipotesi sbagliata.
 *
 * Qui si legge quindi **l'oggetto**, mai un nome letterale. Un accesso
 * calcolato non è sostituibile: il bundler non sa quale chiave verrà chiesta,
 * lascia il codice com'è, e al runtime si legge ciò che la piattaforma ha
 * davvero iniettato.
 */
/**
 * Da dove viene la chiave che sta cifrando, adesso.
 *
 * Due fonti e non una, per la ragione scritta in
 * [ADR-0011](../../../docs/architecture/ADR-0011-chiave-derivata.md): su
 * un'installazione reale `SECRETS_KEY` non raggiunge il processo, e il portale
 * è rimasto inutilizzabile per tre giorni mentre se ne cercava la causa.
 *
 * La distinzione non è un dettaglio interno: chi ruota `AUTH_SECRET` deve
 * sapere se sta anche rendendo illeggibili le credenziali dei progetti, e
 * questo tipo è ciò che permette all'interfaccia di dirglielo.
 */
export type KeySource = "secrets-key" | "derived-from-auth-secret";

/**
 * Il materiale da cui si deriva, quando `SECRETS_KEY` non c'è.
 *
 * `salt` e `info` sono costanti pubbliche e devono restarlo: il segreto è
 * `AUTH_SECRET`, non questi. Cambiarne uno dei due cambia la chiave derivata e
 * rende illeggibile tutto ciò che è già cifrato, quindi la `v1` nel salt è lì
 * per permettere un cambio futuro **dichiarato** invece che accidentale.
 */
const DERIVATION_SALT = "scrum-master-ai/secrets/v1";
const DERIVATION_INFO = "custodia-credenziali-progetto";

/**
 * Quanta entropia deve avere `AUTH_SECRET` perché derivarne una chiave abbia
 * senso.
 *
 * HKDF non crea entropia: la distribuisce. Derivare da una passphrase corta
 * produrrebbe una chiave che *sembra* a 256 bit e porta la robustezza della
 * passphrase — esattamente il falso senso di sicurezza che ADR-0010 rifiuta.
 * Sedici byte è il minimo sotto cui la derivazione viene rifiutata invece che
 * eseguita.
 */
const MIN_DERIVATION_BYTES = 16;

function processEnvironment(): Readonly<Record<string, string | undefined>> {
  // Non sostituire con `process.env.SECRETS_KEY`: quella forma viene congelata
  // in fase di build, quando la variabile può non esistere ancora.
  return process.env as unknown as Readonly<Record<string, string | undefined>>;
}

/**
 * `AUTH_SECRET` come materiale di derivazione, se ne ha la sostanza.
 *
 * Restituisce `null` — e non lancia — quando non è utilizzabile: chi chiama
 * deve poter distinguere «non c'è niente da cui derivare» da «la derivazione è
 * fallita», e la prima è una condizione ordinaria di un'installazione appena
 * creata.
 */
function derivationMaterial(
  env: Readonly<Record<string, string | undefined>>,
): Buffer | null {
  const raw = env["AUTH_SECRET"]?.trim();
  if (!raw) return null;

  /*
   * Prima come base64, poi come testo.
   *
   * Lo script che lo genera produce base64, ma `AUTH_SECRET` è una variabile
   * che una persona può aver scritto a mano. Interpretarla sempre come base64
   * scarterebbe silenziosamente i caratteri fuori alfabeto e produrrebbe meno
   * entropia di quella che c'è.
   */
  const decoded = Buffer.from(raw, "base64");
  const material =
    decoded.length >= MIN_DERIVATION_BYTES ? decoded : Buffer.from(raw, "utf8");

  return material.length >= MIN_DERIVATION_BYTES ? material : null;
}

function derive(material: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", material, DERIVATION_SALT, DERIVATION_INFO, KEY_BYTES),
  );
}

export function masterKey(
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): Buffer {
  const raw = env["SECRETS_KEY"]?.trim();

  if (raw) {
    const decoded = Buffer.from(raw, "base64");

    if (decoded.length !== KEY_BYTES) {
      throw new SecretsUnavailableError(
        `SECRETS_KEY deve essere ${KEY_BYTES} byte in base64, ne ha ${decoded.length}. ` +
          "Una chiave più corta allungata a forza sembra lunga e non lo è.",
      );
    }

    return decoded;
  }

  /*
   * `SECRETS_KEY` assente: si deriva, invece di rifiutarsi (ADR-0011).
   *
   * Non è un ripiego sul chiaro — quello resta vietato e non accade mai. È una
   * seconda chiave ricavata da un segreto che ha già l'entropia giusta, che è
   * ciò per cui HKDF esiste.
   */
  const material = derivationMaterial(env);

  if (!material) {
    throw new SecretsUnavailableError(
      "Nessuna chiave di custodia: né SECRETS_KEY né un AUTH_SECRET da cui derivarla. " +
        "Generane una con `npm run chiave`.",
    );
  }

  return derive(material);
}

/**
 * Da quale delle due fonti verrebbe la chiave, senza calcolarla.
 *
 * Serve all'interfaccia, che deve poter dire «sto usando una chiave derivata»
 * prima che qualcuno ruoti `AUTH_SECRET` senza sapere cosa comporta.
 */
export function keySource(
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): KeySource | null {
  const raw = env["SECRETS_KEY"]?.trim();
  if (raw && Buffer.from(raw, "base64").length === KEY_BYTES) return "secrets-key";
  if (raw) return null;

  return derivationMaterial(env) ? "derived-from-auth-secret" : null;
}

/** Whether secrets can be handled at all, without throwing to ask. */
export function secretsAvailable(
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): boolean {
  return secretsStatus(env).ok;
}

/**
 * Why secrets cannot be handled, when they cannot.
 *
 * **Due cause con lo stesso sintomo, e questa funzione le separa.** Una chiave
 * assente e una chiave incollata male producevano lo stesso identico messaggio,
 * «questa installazione non ha una chiave di custodia» — e la seconda è quella
 * in cui una persona ha già fatto il lavoro giusto. Chi legge quel messaggio
 * dopo aver incollato la chiave conclude che non è stata salvata, e torna a
 * incollarla: il ciclo può durare a lungo, perché ogni tentativo produce lo
 * stesso esito.
 *
 * Il caso `malformed` succede più spesso di quanto sembri: un carattere perso
 * incollando, un a capo aggiunto dal pannello, base64url al posto di base64.
 *
 * **La lunghezza si può dire, il valore no** (§8.3). «Ne ha 31 invece di 32»
 * non rivela nulla di segreto — la lunghezza attesa è pubblica, sta in questo
 * file — e trasforma una caccia al fantasma in una correzione di dieci secondi.
 */
export type SecretsStatus =
  /** Si può cifrare. `source` dice con quale chiave, e non è indifferente. */
  | { readonly ok: true; readonly source: KeySource }
  | { readonly ok: false; readonly reason: "missing" }
  | { readonly ok: false; readonly reason: "malformed"; readonly bytes: number };

export function secretsStatus(
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): SecretsStatus {
  const raw = env["SECRETS_KEY"]?.trim();

  if (raw) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== KEY_BYTES) {
      return { ok: false, reason: "malformed", bytes: decoded.length };
    }

    return { ok: true, source: "secrets-key" };
  }

  /*
   * Senza `SECRETS_KEY` si può ancora cifrare, derivando (ADR-0011).
   *
   * `missing` resta per il caso in cui non ci sia **nulla** da cui derivare:
   * un'installazione appena creata, dove il messaggio giusto è ancora
   * «generane una».
   */
  return derivationMaterial(env)
    ? { ok: true, source: "derived-from-auth-secret" }
    : { ok: false, reason: "missing" };
}

/**
 * Encrypts a secret.
 *
 * The output is `v1.<iv>.<tag>.<ciphertext>`, all base64url. Separate pieces
 * rather than one blob because each has a fixed meaning, and a format whose
 * parts can be told apart is one that can be checked before being used.
 */
export function seal(
  plaintext: string,
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): SealedSecret {
  if (plaintext === "") {
    throw new SecretCorruptedError("Un segreto vuoto non si cifra: si cancella.");
  }

  const key = masterKey(env);

  // Casuale a ogni chiamata. È la riga che tiene in piedi tutto il resto.
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".") as SealedSecret;
}

/**
 * Decrypts a secret, or refuses.
 *
 * Every failure is the same kind of failure — `SecretCorruptedError` — whether
 * the format was wrong, the tag did not match or the key was different. Telling
 * them apart would hand an attacker a way to ask questions about the ciphertext
 * one at a time, which is how padding oracles work.
 */
export function unseal(
  sealed: string,
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): string {
  const parts = sealed.split(".");

  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new SecretCorruptedError("Il segreto non è nel formato atteso.");
  }

  const key = masterKey(env);

  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretCorruptedError("Il segreto non è nel formato atteso.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Il messaggio non dice **perché**: chiave sbagliata, testo alterato e
    // formato corrotto restano indistinguibili da fuori.
    throw new SecretCorruptedError("Il segreto non è leggibile con la chiave attuale.");
  }
}

/**
 * What a screen may say about a secret.
 *
 * Four characters, and only if there are more than eight: on a short secret four
 * characters are a meaningful fraction of it, and «mostrarne un pezzo» smette di
 * essere un indizio e diventa una fuga.
 */
export function hintOf(plaintext: string): SecretHint {
  return {
    tail: plaintext.length > 8 ? plaintext.slice(-4) : "",
    length: plaintext.length,
  };
}

/**
 * Whether two secrets are the same, in constant time.
 *
 * Used to tell «the user retyped the same key» from «the user changed it», so an
 * unchanged key is not re-encrypted for nothing. Constant time because comparing
 * secrets with `===` leaks their common prefix through how long it takes — a
 * small leak, and one that costs a single function call to avoid.
 */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // `timingSafeEqual` esige la stessa lunghezza: confrontarla prima è
  // inevitabile, e la lunghezza di un segreto non è il segreto.
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}
