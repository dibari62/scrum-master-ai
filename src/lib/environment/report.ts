import { secretsStatus } from "@/lib/secrets";

/**
 * Che cosa il server vede davvero nel proprio ambiente.
 *
 * **Perché esiste.** `node scripts/check-env.mjs` risponde alla stessa domanda
 * sul portatile, e online non c'era modo di rispondervi affatto: l'unico
 * segnale era un avviso rosso su una schermata di configurazione, che diceva
 * «manca la chiave di custodia» senza dire nulla del resto. Chi aggiunge una
 * variabile a un pannello di hosting e ricarica non ha modo di sapere se è
 * arrivata, se è arrivata **nell'ambiente giusto**, o se manca solo un nuovo
 * deploy — e ogni tentativo produce la stessa schermata di quello prima.
 *
 * È l'equivalente online di `check-env`, e nasce da un problema vero: una
 * variabile mancante ha richiesto un giro di verifiche manuali che questa
 * pagina chiude in due secondi.
 *
 * ## Che cosa non fa, e non è una dimenticanza
 *
 * **Non mostra mai un valore.** Nemmeno accorciato, nemmeno le ultime quattro
 * cifre. Una variabile qui è o presente o assente; l'unica eccezione è
 * `SECRETS_KEY`, di cui si dice la **lunghezza** quando è sbagliata — perché la
 * lunghezza attesa è pubblica e senza quel numero l'errore è invisibile.
 *
 * **Non elenca ciò che trova**, ma ciò che si aspetta. Un elenco costruito da
 * `process.env` stamperebbe l'intero ambiente della piattaforma, che contiene
 * cose che non ci riguardano e alcune che non vanno guardate. L'elenco è chiuso
 * e scritto qui sotto.
 */

/** Quanto pesa l'assenza di una variabile. */
export type EnvironmentSeverity =
  /** Senza, una parte del portale non funziona. */
  | "required"
  /** Senza, una funzione facoltativa semplicemente non compare. */
  | "optional";

export type EnvironmentState =
  | "present"
  | "absent"
  /** C'è, ma non ha la forma richiesta. Oggi solo `SECRETS_KEY` può esserlo. */
  | "invalid";

export type EnvironmentEntry = {
  readonly name: string;
  readonly severity: EnvironmentSeverity;
  readonly state: EnvironmentState;
  /** A che cosa serve, in una frase per chi non ha scritto il codice. */
  readonly purpose: string;
  /** Che cosa succede senza. Presente quando manca o non è valida. */
  readonly consequence: string | null;
};

export type EnvironmentReport = {
  readonly entries: readonly EnvironmentEntry[];
  /** Quante fra le necessarie mancano o non sono valide. */
  readonly problems: number;
};

type Expectation = {
  readonly name: string;
  readonly severity: EnvironmentSeverity;
  readonly purpose: string;
  readonly consequence: string;
};

/**
 * L'elenco chiuso delle variabili che riguardano il portale.
 *
 * Deliberatamente **senza** `LLM_PROVIDER` e le chiavi dei fornitori: dopo
 * ADR-0010 non configurano nulla del portale, e mostrarle qui rimetterebbe in
 * circolo l'idea che il modello si scelga da un pannello di hosting.
 */
const EXPECTED: readonly Expectation[] = [
  {
    name: "DATABASE_URL",
    severity: "required",
    purpose: "La connessione al database, con il pooler.",
    consequence: "Nessuna pagina che legge dati può funzionare.",
  },
  {
    name: "AUTH_SECRET",
    severity: "required",
    purpose: "Firma le sessioni di chi accede.",
    consequence: "L'accesso non funziona.",
  },
  {
    name: "SECRETS_KEY",
    severity: "required",
    purpose:
      "Cifra i token e le chiavi dei modelli che i progetti inseriscono, prima che tocchino il database.",
    consequence:
      "Il portale rifiuta di conservare credenziali: il campo «Chiave API» resta bloccato, e lo stesso vale per il token di Jira.",
  },
  {
    name: "AUTH_GITHUB_ID",
    severity: "optional",
    purpose: "Applicazione OAuth per l'accesso con GitHub.",
    consequence: "Il pulsante «Continua con GitHub» non compare. L'accesso con email resta.",
  },
  {
    name: "AUTH_GITHUB_SECRET",
    severity: "optional",
    purpose: "La metà segreta della stessa applicazione OAuth.",
    consequence: "Come sopra: le due vanno insieme.",
  },
  {
    name: "JOB_SECRET",
    severity: "optional",
    purpose: "Autentica le chiamate ai job schedulati.",
    consequence: "Nessuno finché non esiste un job: oggi le letture si avviano a mano.",
  },
];

export function environmentReport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EnvironmentReport {
  const entries = EXPECTED.map((expected): EnvironmentEntry => {
    const state = stateOf(expected.name, env);

    return {
      name: expected.name,
      severity: expected.severity,
      state,
      purpose: expected.purpose,
      consequence: state === "present" ? null : expected.consequence,
    };
  });

  const problems = entries.filter(
    (entry) => entry.severity === "required" && entry.state !== "present",
  ).length;

  return { entries, problems };
}

/**
 * `SECRETS_KEY` è l'unica di cui si controlla anche la **forma**.
 *
 * Per le altre «c'è» è tutto ciò che si può dire senza guardarne il contenuto,
 * e guardarlo è esattamente ciò che questa pagina non fa. Per la chiave di
 * custodia la forma è verificabile senza leggere nulla di segreto — è una
 * lunghezza — ed è la distinzione che risparmia il giro di tentativi fra «non
 * l'ho messa» e «l'ho incollata male».
 */
function stateOf(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): EnvironmentState {
  if (name === "SECRETS_KEY") {
    const status = secretsStatus(env);
    if (status.ok) return "present";
    return status.reason === "missing" ? "absent" : "invalid";
  }

  const raw = env[name]?.trim();
  return raw ? "present" : "absent";
}

/** Il dettaglio in più per una chiave di custodia incollata male. */
export function custodyDetail(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const status = secretsStatus(env);
  if (status.ok || status.reason !== "malformed") return null;

  return (
    `Contiene ${status.bytes} byte invece di 32. Di solito è un carattere perso ` +
    "incollando, un a capo aggiunto dal pannello, oppure una chiave in base64url " +
    "anziché base64."
  );
}

/**
 * Quale deploy sta rispondendo, e in quale ambiente.
 *
 * **Senza questo, la diagnosi resta ambigua**, e la storia che ha portato a
 * scriverlo lo dimostra: tre variabili presenti nel pannello di Vercel
 * risultavano assenti al server. Guardando solo l'elenco non c'era modo di
 * distinguere fra «il deploy è vecchio», «sto guardando le variabili di un
 * altro progetto» e «questo server gira come *preview*, dove quelle variabili
 * non sono state messe».
 *
 * Sono tre cause con lo stesso sintomo, e ognuna richiede un gesto diverso.
 *
 * Vercel popola queste variabili da sé a ogni build. Nessuna è segreta: il
 * commit è pubblico su GitHub, e l'ambiente è ciò che l'indirizzo già lascia
 * intuire. Fuori da Vercel — in locale — non esistono, e la sezione lo dice
 * invece di inventare valori.
 */
export type DeploymentFacts = {
  /** `production`, `preview`, `development`, oppure `null` fuori da Vercel. */
  readonly environment: string | null;
  /** I primi sette caratteri del commit, come li scrive git. */
  readonly commit: string | null;
  readonly branch: string | null;
  /** Se stiamo girando su Vercel affatto. */
  readonly onVercel: boolean;
};

export function deploymentFacts(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DeploymentFacts {
  const sha = env["VERCEL_GIT_COMMIT_SHA"]?.trim();

  return {
    environment: env["VERCEL_ENV"]?.trim() ?? null,
    commit: sha ? sha.slice(0, 7) : null,
    branch: env["VERCEL_GIT_COMMIT_REF"]?.trim() ?? null,
    onVercel: Boolean(env["VERCEL"]?.trim()),
  };
}
