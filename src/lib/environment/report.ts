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

  /**
   * Come si presenta il valore, senza mostrarlo.
   *
   * **Tre situazioni che «assente» confondeva in una sola**, e distinguerle è
   * ciò che ha smontato due ipotesi sbagliate di fila:
   *
   * - `missing-key`: il nome non esiste proprio nell'oggetto;
   * - `empty`: il nome c'è, il valore è vuoto — è quello che succede quando una
   *   variabile è dichiarata nel pannello ma non arriva al processo;
   * - `filled`: c'è ed è valorizzata.
   *
   * La differenza fra le prime due dice **dove guardare**: la prima è una
   * variabile mai definita, la seconda è una variabile definita che non
   * raggiunge questo runtime. Sono guasti diversi con lo stesso sintomo.
   */
  readonly shape: "missing-key" | "empty" | "filled";

  /**
   * Vera quando la variabile **c'è al runtime** ma il pacchetto ne porta una
   * copia vuota, congelata in fase di build.
   *
   * È la firma del difetto costato tre giorni: un modulo che la leggesse con un
   * riferimento letterale otterrebbe il vuoto, mentre l'oggetto del processo ha
   * il valore giusto. Mostrarla serve a riconoscerlo in un colpo d'occhio,
   * invece di dedurlo confrontando due schermate.
   */
  readonly bundlerFroze: boolean;
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
    severity: "optional",
    purpose:
      "Cifra i token e le chiavi dei modelli che i progetti inseriscono, prima che tocchino il database.",
    consequence:
      "La chiave viene derivata da AUTH_SECRET (ADR-0011): il portale funziona, ma ruotare AUTH_SECRET renderebbe illeggibili le credenziali già salvate.",
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

/**
 * L'ambiente **del processo**, non quello inciso nel pacchetto compilato.
 *
 * ## Il difetto, e perché il rimedio precedente lo peggiorava
 *
 * Next.js sostituisce a tempo di build le occorrenze **letterali** di
 * `process.env.NOME` con il loro valore. Sembra un dettaglio innocuo, e per la
 * maggior parte delle variabili lo è. Non lo è per quelle che **a tempo di
 * build non esistono**: su Vercel le variabili di tipo *Secret* sono
 * disponibili solo al runtime, quindi il bundler le sostituisce con una
 * **stringa vuota** e quel vuoto resta inciso nel pacchetto per sempre.
 *
 * Il rimedio precedente faceva esattamente la cosa sbagliata: raccoglieva
 * riferimenti letterali «perché il bundler li vede». Li vedeva, appunto — e li
 * congelava a vuoto. Una variabile perfettamente configurata risultava assente
 * a ogni avvio.
 *
 * **La prova è arrivata da una contraddizione dentro la stessa pagina**:
 * `Object.keys(process.env)` elencava il nome (quindi al runtime la variabile
 * c'è), e la riga accanto lo dava per vuoto (quindi il letterale era stato
 * congelato). Le uniche due che «funzionavano» — `DATABASE_URL` e
 * `AUTH_SECRET` — sono quelle disponibili anche in fase di build.
 *
 * Qui si legge quindi **l'oggetto**, mai un nome letterale. Un accesso
 * calcolato non è sostituibile: il bundler non sa quale chiave verrà chiesta,
 * lascia il codice com'è, e al runtime si legge ciò che la piattaforma ha
 * davvero iniettato.
 */
function processEnvironment(): Readonly<Record<string, string | undefined>> {
  return process.env as unknown as Readonly<Record<string, string | undefined>>;
}

/**
 * Lo stesso ambiente, ma nella forma che il bundler **congela**.
 *
 * Serve solo alla diagnostica: affiancato a quello vero rende visibile la
 * differenza fra «la variabile non c'è» e «la variabile c'è ma il pacchetto
 * contiene il vuoto che aveva in fase di build». Senza questo confronto la
 * causa resta invisibile, ed è ciò che ha portato a tre ipotesi sbagliate.
 */
function bundledEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    SECRETS_KEY: process.env.SECRETS_KEY,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    JOB_SECRET: process.env.JOB_SECRET,
  };
}

export function environmentReport(
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
): EnvironmentReport {
  /*
   * L'ambiente congelato nel pacchetto, accanto a quello vero.
   *
   * Se una variabile risulta valorizzata a runtime e vuota qui, il pacchetto
   * porta dentro di sé il vuoto che quella variabile aveva in fase di build:
   * è la firma del difetto, e vale la pena poterlo vedere invece di dedurlo.
   */
  const bundled = bundledEnvironment();

  const entries = EXPECTED.map((expected): EnvironmentEntry => {
    const state = stateOf(expected.name, env);
    const value = env[expected.name];

    const shape: EnvironmentEntry["shape"] =
      value === undefined
        ? expected.name in env
          ? "empty"
          : "missing-key"
        : value.trim() === ""
          ? "empty"
          : "filled";

    const frozen = bundled[expected.name];
    const bundlerFroze =
      shape === "filled" && (frozen === undefined || frozen.trim() === "");

    return {
      name: expected.name,
      severity: expected.severity,
      state,
      purpose: expected.purpose,
      consequence: state === "present" ? null : expected.consequence,
      shape,
      bundlerFroze,
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
  const raw = env[name]?.trim();

  /*
   * Per `SECRETS_KEY` si controlla anche la **forma**, ma non la disponibilità
   * della custodia.
   *
   * La distinzione è sottile e conta: questa riga parla della **variabile**,
   * mentre la capacità di cifrare — che da ADR-0011 sopravvive alla sua assenza,
   * derivando da `AUTH_SECRET` — ha una sezione tutta sua. Confonderle
   * produrrebbe una riga che dice «presente» su una variabile che non c'è,
   * cioè la cosa peggiore che una pagina di diagnostica possa fare.
   */
  if (name === "SECRETS_KEY" && raw) {
    return Buffer.from(raw, "base64").length === 32 ? "present" : "invalid";
  }

  return raw ? "present" : "absent";
}

/**
 * Le quattro forme in cui si può chiedere la stessa variabile.
 *
 * **Perché una misura invece di un altro tentativo.** Su questo guasto si sono
 * susseguite quattro ipotesi, ognuna plausibile e ognuna smentita dal deploy
 * successivo. Il costo di sbagliare è alto — un giro completo di build — quindi
 * qui si chiedono **tutte le forme insieme** e si guarda quale risponde.
 *
 * Le forme differiscono solo per quanto un bundler riesce a capirle:
 *
 * - `letterale`: `process.env.NOME`, l'unica che Next.js sostituisce a tempo di
 *   build. Se la variabile non esiste ancora in quel momento, resta il vuoto.
 * - `oggetto`: `process.env[nome]` con un nome calcolato. Non sostituibile per
 *   nome, ma `process.env` stesso può essere un oggetto ricostruito dal
 *   bundler.
 * - `globale`: lo stesso, raggiunto da `globalThis`. Un bundler non può
 *   rimpiazzare `globalThis` senza rompere tutto il resto.
 * - `nomeSpezzato`: il nome composto a runtime, così nessuna analisi statica
 *   può riconoscerlo.
 *
 * Se una risponde e le altre no, il rimedio è scritto nella riga stessa. Se
 * nessuna risponde, la variabile non raggiunge il processo e il problema è
 * nella piattaforma, non nel codice.
 *
 * **Nessun valore compare**: solo se la lettura ha prodotto qualcosa.
 */
export type ReadingProbe = {
  readonly name: string;
  readonly letterale: boolean;
  readonly oggetto: boolean;
  readonly globale: boolean;
  readonly nomeSpezzato: boolean;
};

export function readingProbes(): readonly ReadingProbe[] {
  const filled = (value: unknown): boolean =>
    typeof value === "string" && value.trim() !== "";

  const viaGlobal = (name: string): unknown => {
    const holder = globalThis as unknown as {
      readonly process?: { readonly env?: Record<string, unknown> };
    };
    return holder.process?.env?.[name];
  };

  const dynamic = process.env as unknown as Record<string, unknown>;

  return [
    {
      name: "SECRETS_KEY",
      letterale: filled(process.env.SECRETS_KEY),
      oggetto: filled(dynamic["SECRETS_KEY"]),
      globale: filled(viaGlobal("SECRETS_KEY")),
      // Composto a runtime: nessuna analisi statica può riconoscerlo.
      nomeSpezzato: filled(viaGlobal(["SECRETS", "KEY"].join("_"))),
    },
    {
      name: "AUTH_SECRET",
      letterale: filled(process.env.AUTH_SECRET),
      oggetto: filled(dynamic["AUTH_SECRET"]),
      globale: filled(viaGlobal("AUTH_SECRET")),
      nomeSpezzato: filled(viaGlobal(["AUTH", "SECRET"].join("_"))),
    },
  ];
}

/** Il dettaglio in più per una chiave di custodia incollata male. */
export function custodyDetail(
  env: Readonly<Record<string, string | undefined>> = processEnvironment(),
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
  /** L'indirizzo di *questo* deploy: dice a quale progetto appartiene. */
  readonly url: string | null;

  /**
   * Quante variabili vede il processo, in tutto.
   *
   * **Un numero, non un elenco**, e serve a distinguere due guasti che si
   * assomigliano. Su Vercel un processo ne vede diverse decine — la piattaforma
   * ne inietta molte per conto suo. Se qui comparisse un numero piccolo, il
   * problema non sarebbe «manca quella variabile» ma «a questo processo non
   * arriva quasi niente», che è una diagnosi completamente diversa e porta a
   * guardare altrove.
   */
  readonly variableCount: number;

  /**
   * I nomi che riguardano l'applicazione, fra quelli presenti.
   *
   * **Nomi, mai valori.** Un nome non è un segreto: Vercel stessa li mostra nel
   * proprio pannello, ed è esattamente il confronto che serve — «nel pannello
   * ne vedo sei, il server ne vede due» è una frase che chiude una diagnosi.
   *
   * Filtrati per prefisso noto: l'elenco completo conterrebbe decine di
   * variabili della piattaforma, e quelle non ci riguardano.
   */
  readonly applicationNames: readonly string[];
};

/** I prefissi che appartengono a questa applicazione, non alla piattaforma. */
const APPLICATION_PREFIXES = ["AUTH_", "DATABASE_", "SECRETS_", "JOB_", "QSTASH_", "LOG_", "LLM_"];

export function deploymentFacts(
  /*
   * Qui `process.env` **diretto**, ed è voluto.
   *
   * A differenza del rapporto qui sopra, questa funzione non chiede singole
   * variabili per nome: le **conta** e le **enumera**, e per farlo serve
   * l'oggetto vero del processo. È esattamente l'incoerenza fra questo elenco e
   * le righe del rapporto che ha permesso di trovare il difetto del bundler:
   * `Object.keys` vedeva dieci nomi che l'accesso calcolato non riusciva a
   * leggere.
   */
  env: Readonly<Record<string, string | undefined>> = process.env,
): DeploymentFacts {
  const sha = env["VERCEL_GIT_COMMIT_SHA"]?.trim();

  const names = Object.keys(env)
    .filter((name) => APPLICATION_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort();

  return {
    environment: env["VERCEL_ENV"]?.trim() ?? null,
    commit: sha ? sha.slice(0, 7) : null,
    branch: env["VERCEL_GIT_COMMIT_REF"]?.trim() ?? null,
    onVercel: Boolean(env["VERCEL"]?.trim()),
    url: env["VERCEL_URL"]?.trim() ?? null,
    variableCount: Object.keys(env).length,
    applicationNames: names,
  };
}
