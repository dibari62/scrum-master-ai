import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  hintOf,
  keySource,
  masterKey,
  sameSecret,
  seal,
  SecretCorruptedError,
  secretsAvailable,
  secretsStatus,
  SecretsUnavailableError,
  unseal,
} from "@/lib/secrets";

/**
 * La cifratura dei segreti dei clienti.
 *
 * Ogni verifica qui corrisponde a un modo concreto in cui la chiave API di
 * qualcun altro potrebbe uscire da questo portale. Non sono controlli di
 * correttezza matematica — quella la fa Node — ma di **uso corretto**, che è la
 * parte in cui si sbaglia.
 */

const ENV = { SECRETS_KEY: randomBytes(32).toString("base64") };

const CHIAVE_FINTA = "AIzaSyD-esempio-non-vera-0123456789abcdef";

describe("chiave principale", () => {
  it("legge SECRETS_KEY dall'oggetto del processo, non da un letterale congelato", () => {
    /*
     * Il difetto che ha bloccato una configurazione corretta per tre giorni, e
     * il motivo per cui questo test verifica il **sorgente**: il comportamento
     * in locale è identico nei due casi, quindi nessun test funzionale può
     * distinguerli.
     *
     * Next.js sostituisce a tempo di build le occorrenze **letterali** di
     * `process.env.NOME`. Su Vercel una variabile di tipo *Secret* non esiste
     * in fase di build: viene sostituita con una stringa vuota, e quel vuoto
     * resta inciso nel pacchetto. La chiave risultava assente pur essendo
     * configurata, e il portale rifiutava le credenziali dicendo che mancava la
     * chiave di custodia.
     *
     * Un tentativo precedente di rimediare andò nella direzione opposta —
     * raccogliere riferimenti letterali «perché il bundler li vede» — e
     * peggiorò le cose. Da qui il test: il modulo **non deve** contenere
     * `process.env.SECRETS_KEY`.
     */
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "src", "lib", "secrets", "index.ts"),
      "utf8",
    );

    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");

    expect(code).not.toContain("process.env.SECRETS_KEY");
    expect(code).toContain("process.env as unknown as");
  });

  it("rifiuta l'assenza invece di ripiegare sul chiaro", () => {
    // Un ripiego silenzioso sarebbe come non aver preso la decisione, con in
    // più la convinzione di averla presa.
    expect(() => masterKey({})).toThrow(SecretsUnavailableError);
    expect(secretsAvailable({})).toBe(false);
  });

  it("rifiuta una chiave più corta invece di allungarla", () => {
    /*
     * Una passphrase allungata a forza sembra una chiave a 256 bit e porta la
     * robustezza della passphrase. È esattamente il falso senso di sicurezza per
     * cui questo modulo esiste.
     */
    const corta = { SECRETS_KEY: randomBytes(16).toString("base64") };

    expect(() => masterKey(corta)).toThrow(/32 byte/);
  });

  it("dice come rimediare, non solo che c'è un problema", () => {
    // Il nome del comando, non quello del file: chi legge l'errore deve poter
    // copiare la riga senza doverla tradurre.
    expect(() => masterKey({})).toThrow(/npm run chiave/);
  });
});

describe("perché la custodia non è pronta", () => {
  /*
   * Due cause con lo stesso sintomo, e la distinzione è tutto il valore.
   *
   * «Chiave assente» e «chiave incollata male» producevano lo stesso identico
   * messaggio a schermo. La seconda è la situazione in cui una persona ha già
   * fatto il lavoro giusto: leggere «non c'è» dopo averla messa porta a
   * rimetterla, e ogni tentativo produce lo stesso esito.
   */

  it("distingue l'assenza dalla chiave incollata male", () => {
    const assente = secretsStatus({});
    const rotta = secretsStatus({ SECRETS_KEY: randomBytes(31).toString("base64") });

    expect(assente.ok).toBe(false);
    if (!assente.ok) expect(assente.reason).toBe("missing");

    expect(rotta.ok).toBe(false);
    if (!rotta.ok) expect(rotta.reason).toBe("malformed");
  });

  it("dice quanti byte ha trovato, così l'errore si corregge invece di cercarlo", () => {
    const rotta = secretsStatus({ SECRETS_KEY: randomBytes(16).toString("base64") });

    if (rotta.ok) throw new Error("attesa non valida");
    if (rotta.reason !== "malformed") throw new Error("atteso malformed");
    expect(rotta.bytes).toBe(16);
  });

  it("una chiave con spazi intorno resta valida", () => {
    // Incollare da un pannello aggiunge spesso uno spazio o un a capo, e
    // rifiutare per quello sarebbe un'ora persa su un problema inesistente.
    expect(secretsStatus({ SECRETS_KEY: `  ${ENV.SECRETS_KEY}\n` }).ok).toBe(true);
  });

  it("non riporta mai il valore, solo la sua lunghezza (§8.3)", () => {
    /*
     * La lunghezza attesa è pubblica: sta scritta nel modulo. Dirla non rivela
     * nulla, e trasforma una caccia al fantasma in una correzione di dieci
     * secondi. Il valore invece non deve comparire da nessuna parte.
     */
    const chiave = randomBytes(20).toString("base64");
    const rotta = secretsStatus({ SECRETS_KEY: chiave });

    expect(JSON.stringify(rotta)).not.toContain(chiave);
  });

  it("concorda sempre con secretsAvailable", () => {
    // Due risposte alla stessa domanda sono un'occasione per divergere: qui
    // `secretsAvailable` è definita in termini di `secretsStatus`, e questo
    // test è ciò che impedisce di riscriverla a parte.
    for (const env of [
      {},
      { SECRETS_KEY: "" },
      { SECRETS_KEY: randomBytes(31).toString("base64") },
      ENV,
    ]) {
      expect(secretsAvailable(env)).toBe(secretsStatus(env).ok);
    }
  });
});

describe("chiave derivata da AUTH_SECRET (ADR-0011)", () => {
  /*
   * Nasce da un guasto reale: su un'installazione di produzione `SECRETS_KEY`
   * non raggiunge il processo — misurato, non supposto — e il portale è rimasto
   * inutilizzabile per tre giorni mentre se ne cercava la causa.
   *
   * Derivare non è ripiegare sul chiaro, che resta vietato: è ricavare una
   * seconda chiave da un segreto che ha già l'entropia giusta, che è ciò per
   * cui HKDF esiste.
   */

  const AUTH = { AUTH_SECRET: randomBytes(32).toString("base64") };

  it("cifra e decifra anche senza SECRETS_KEY", () => {
    const sealed = seal(CHIAVE_FINTA, AUTH);
    expect(unseal(sealed, AUTH)).toBe(CHIAVE_FINTA);
  });

  it("SECRETS_KEY vince quando c'è", () => {
    /*
     * L'ordine di precedenza è la parte che rende la derivazione reversibile:
     * chi imposta la variabile torna alla configurazione preferibile senza
     * dover migrare nulla — a patto di reinserire le credenziali, perché la
     * chiave cambia.
     */
    const entrambe = { ...ENV, ...AUTH };
    const sealed = seal(CHIAVE_FINTA, entrambe);

    expect(unseal(sealed, ENV)).toBe(CHIAVE_FINTA);
  });

  it("la chiave derivata è diversa da AUTH_SECRET", () => {
    /*
     * Se la derivazione restituisse il materiale così com'è, chi legge il
     * database e conosce il segreto di sessione avrebbe le credenziali senza
     * fare nulla. HKDF esiste per impedirlo.
     */
    const sealed = seal(CHIAVE_FINTA, AUTH);
    const comeSe = { SECRETS_KEY: AUTH.AUTH_SECRET };

    expect(() => unseal(sealed, comeSe)).toThrow(SecretCorruptedError);
  });

  it("due AUTH_SECRET diversi producono chiavi diverse", () => {
    // La verifica che la derivazione dipenda davvero dal materiale, e non sia
    // una costante travestita.
    const altro = { AUTH_SECRET: randomBytes(32).toString("base64") };
    const sealed = seal(CHIAVE_FINTA, AUTH);

    expect(() => unseal(sealed, altro)).toThrow(SecretCorruptedError);
  });

  it("lo stesso AUTH_SECRET produce sempre la stessa chiave", () => {
    // Senza questo, un riavvio renderebbe illeggibile tutto ciò che è stato
    // cifrato prima — e il guasto sarebbe intermittente, cioè il peggiore.
    const sealed = seal(CHIAVE_FINTA, { ...AUTH });
    expect(unseal(sealed, { ...AUTH })).toBe(CHIAVE_FINTA);
  });

  it("rifiuta di derivare da un AUTH_SECRET troppo corto", () => {
    /*
     * HKDF non crea entropia, la distribuisce. Derivare da una passphrase
     * corta produrrebbe una chiave che *sembra* a 256 bit e porta la robustezza
     * della passphrase: è il falso senso di sicurezza che ADR-0010 rifiuta, e
     * continua a rifiutare.
     */
    expect(() => masterKey({ AUTH_SECRET: "corta" })).toThrow(SecretsUnavailableError);
    expect(secretsAvailable({ AUTH_SECRET: "corta" })).toBe(false);
  });

  it("dichiara quale fonte sta usando", () => {
    // Chi ruota AUTH_SECRET deve sapere se sta anche rendendo illeggibili le
    // credenziali dei progetti: questa è l'informazione che glielo permette.
    expect(keySource(ENV)).toBe("secrets-key");
    expect(keySource(AUTH)).toBe("derived-from-auth-secret");
    expect(keySource({})).toBeNull();
  });

  it("lo stato dichiara la fonte insieme all'esito", () => {
    const conChiave = secretsStatus(ENV);
    const derivato = secretsStatus(AUTH);

    expect(conChiave.ok && conChiave.source).toBe("secrets-key");
    expect(derivato.ok && derivato.source).toBe("derived-from-auth-secret");
  });

  it("senza nulla da cui derivare resta «missing»", () => {
    // Un'installazione appena creata: il messaggio giusto è ancora «generane
    // una», non «la derivazione è fallita».
    const vuoto = secretsStatus({});

    expect(vuoto.ok).toBe(false);
    if (vuoto.ok) throw new Error("atteso non disponibile");
    expect(vuoto.reason).toBe("missing");
  });

  it("una SECRETS_KEY malformata non ricade sulla derivazione", () => {
    /*
     * Il caso che sarebbe silenzioso e costoso: chi ha incollato male la chiave
     * vedrebbe il portale funzionare, e le credenziali verrebbero cifrate con
     * una chiave diversa da quella che crede. Al momento di correggere
     * l'incollatura, tutto diventerebbe illeggibile senza una ragione visibile.
     */
    const rotta = { SECRETS_KEY: randomBytes(31).toString("base64"), ...AUTH };
    const stato = secretsStatus(rotta);

    expect(stato.ok).toBe(false);
    if (stato.ok) throw new Error("atteso non disponibile");
    expect(stato.reason).toBe("malformed");
    expect(() => masterKey(rotta)).toThrow(SecretsUnavailableError);
  });

  it("non riporta mai il valore di AUTH_SECRET", () => {
    expect(JSON.stringify(secretsStatus(AUTH))).not.toContain(AUTH.AUTH_SECRET);
  });
});

describe("cifratura", () => {
  it("il testo cifrato non contiene il segreto", () => {
    // La verifica più ovvia, e la sola che descrive il danno vero.
    const sealed = seal(CHIAVE_FINTA, ENV);

    expect(sealed).not.toContain(CHIAVE_FINTA);
    expect(sealed).not.toContain("esempio-non-vera");
  });

  it("ciò che si cifra si rilegge identico", () => {
    expect(unseal(seal(CHIAVE_FINTA, ENV), ENV)).toBe(CHIAVE_FINTA);
  });

  it("due cifrature dello stesso segreto sono diverse", () => {
    /*
     * **La verifica che tiene in piedi tutto il resto.** In GCM riusare il
     * vettore di inizializzazione non indebolisce il testo: rompe la cifratura.
     * Con due messaggi sotto lo stesso IV si ricava la chiave di autenticazione,
     * e da lì si può falsificare qualunque testo cifrato.
     *
     * Se questo test diventasse verde con due valori uguali, la cifratura
     * sembrerebbe funzionare e non funzionerebbe più.
     */
    expect(seal(CHIAVE_FINTA, ENV)).not.toBe(seal(CHIAVE_FINTA, ENV));
  });

  it("regge accenti e caratteri fuori dall'alfabeto latino", () => {
    const strano = "token-àèìòù-日本語-🔑-fine";

    expect(unseal(seal(strano, ENV), ENV)).toBe(strano);
  });

  it("un segreto vuoto non si cifra: si cancella", () => {
    // Cifrare il vuoto produrrebbe una riga che *sembra* una chiave configurata.
    expect(() => seal("", ENV)).toThrow(SecretCorruptedError);
  });
});

describe("decifratura", () => {
  it("rifiuta un testo cifrato alterato invece di restituire spazzatura", () => {
    /*
     * È la ragione per cui si usa GCM e non CBC. Senza autenticazione, chi può
     * scrivere sul database può alterare una chiave senza che nessuno se ne
     * accorga finché non fallisce una chiamata — e a quel punto sembra un guasto
     * del fornitore.
     */
    const sealed = seal(CHIAVE_FINTA, ENV);
    const parts = sealed.split(".");
    const alterato = [parts[0], parts[1], parts[2], `${parts[3]}AAAA`].join(".");

    expect(() => unseal(alterato, ENV)).toThrow(SecretCorruptedError);
  });

  it("rifiuta un testo cifrato con una chiave diversa", () => {
    const altra = { SECRETS_KEY: randomBytes(32).toString("base64") };

    expect(() => unseal(seal(CHIAVE_FINTA, ENV), altra)).toThrow(SecretCorruptedError);
  });

  it("non dice quale delle tre cose è andata storta", () => {
    /*
     * Formato sbagliato, firma non valida e chiave diversa danno lo stesso
     * errore. Distinguerli darebbe modo di interrogare il testo cifrato una
     * domanda alla volta, che è il funzionamento di un padding oracle.
     */
    const altra = { SECRETS_KEY: randomBytes(32).toString("base64") };

    const messaggi = [
      catchMessage(() => unseal("non-e-un-segreto", ENV)),
      catchMessage(() => unseal("v1.aaa.bbb.ccc", ENV)),
      catchMessage(() => unseal(seal(CHIAVE_FINTA, ENV), altra)),
    ];

    // Due formulazioni in tutto: «formato» e «non leggibile». Nessuna delle due
    // dice se la chiave fosse giusta.
    for (const messaggio of messaggi) {
      expect(messaggio).not.toMatch(/chiave sbagliata|firma|tag|alterato/i);
    }
  });

  it("rifiuta un formato di versione che non conosce", () => {
    const sealed = seal(CHIAVE_FINTA, ENV);
    const futuro = `v2.${sealed.split(".").slice(1).join(".")}`;

    expect(() => unseal(futuro, ENV)).toThrow(SecretCorruptedError);
  });
});

describe("che cosa si può mostrare a schermo", () => {
  it("mostra solo le ultime quattro cifre", () => {
    const hint = hintOf(CHIAVE_FINTA);

    expect(hint.tail).toBe("cdef");
    expect(CHIAVE_FINTA).not.toContain(`${hint.tail}${hint.tail}`);
  });

  it("su un segreto corto non mostra nulla", () => {
    // Quattro caratteri su otto sono metà del segreto: smette di essere un
    // indizio e diventa una fuga.
    expect(hintOf("corto123").tail).toBe("");
  });
});

describe("confronto fra segreti", () => {
  it("riconosce lo stesso segreto ridigitato", () => {
    // Serve a distinguere «ha riscritto la stessa chiave» da «l'ha cambiata»,
    // per non ricifrare una chiave che non è cambiata.
    expect(sameSecret(CHIAVE_FINTA, CHIAVE_FINTA)).toBe(true);
  });

  it("distingue due segreti che iniziano allo stesso modo", () => {
    expect(sameSecret("AIzaSy-uno", "AIzaSy-due")).toBe(false);
  });

  it("non esplode su lunghezze diverse", () => {
    // `timingSafeEqual` pretende la stessa lunghezza e lancia altrimenti: la
    // lunghezza va confrontata prima, e non è essa stessa un segreto.
    expect(sameSecret("breve", "molto piu lungo")).toBe(false);
  });
});

function catchMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("non ha lanciato nulla");
}
