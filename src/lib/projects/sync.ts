import {
  createJiraConnector,
  createJiraProbe,
  createJiraReader,
  jiraAccountSchema,
  jiraConfigSchema,
} from "@/connectors/jira";
import type { Database } from "@/db";
import { ingestBatch, type IngestReport } from "@/db/ingest";
import { markSynchronised, revealProjectSecret, type SafeProjectSettings } from "@/db/project-settings";
import type { OrganizationId, ProjectId } from "@/domain";
import { logger } from "@/lib/logger";

/**
 * Reading a project's real data, once, on request.
 *
 * Until now the configuration could be saved and nothing used it: the
 * connector could translate, the client could telephone, `ingestBatch` could
 * write, and no single place put the three together. This is that place.
 *
 * **A plain function, not a server action.** A server action cannot be called
 * from a test — its identifier is minted at build time — so everything that
 * decides anything lives here, and the action is a shell that gathers the
 * session and calls this.
 *
 * **Nothing here is scheduled.** One synchronisation per press of a button, so
 * the first version of this feature cannot produce a runaway job against
 * somebody else's rate limit. A timer comes later, when there is something to
 * observe about how long a read actually takes.
 */

/** Why a synchronisation could not even be attempted. */
export type SyncRefusal =
  | "no-connector"
  | "not-jira"
  | "no-credentials"
  | "no-account-email"
  | "bad-configuration"
  | "secrets-unavailable";

export type SyncOutcome =
  | {
      readonly status: "done";
      readonly report: IngestReport;
      readonly at: Date;

      /**
       * Perché la lettura non ha portato elementi, quando non ne ha portati.
       *
       * Assente quando gli elementi ci sono: una diagnosi che compare sempre è
       * rumore, e questa costa una chiamata in più a Jira.
       */
      readonly diagnosis?: EmptyReadDiagnosis;
    }
  | { readonly status: "refused"; readonly reason: SyncRefusal; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

/**
 * Che cosa si è potuto stabilire su una lettura che non ha portato elementi.
 *
 * **Il debito che questo tipo paga.** Finora il portale poteva solo elencare le
 * tre cause possibili e lasciare a chi legge il compito di distinguerle. Sono
 * distinguibili, però: basta chiedere a Jira quali progetti vede l'account del
 * token, e confrontare con la chiave configurata.
 *
 * `unknown` non è un ripiego pigro: è il caso in cui la domanda stessa non ha
 * ricevuto risposta, e allora si torna a dire le tre cause invece di inventare
 * una certezza.
 */
export type EmptyReadDiagnosis =
  | { readonly kind: "key-not-visible"; readonly configured: string; readonly visible: readonly string[] }
  | { readonly kind: "key-visible"; readonly configured: string }
  | { readonly kind: "incremental-window"; readonly configured: string; readonly since: Date }
  | { readonly kind: "nothing-visible" }
  | { readonly kind: "unknown" };

/**
 * What each refusal means, in the words the reader needs.
 *
 * Written next to the reason rather than at the screen, because a refusal is a
 * statement about the configuration and the screen would have to guess at it.
 * Every one of them names the next thing to do: «non configurato» alone leaves
 * a reader looking for a button that may not be on this page.
 */
const REFUSALS: Readonly<Record<SyncRefusal, string>> = {
  "no-connector":
    "Questo progetto non ha ancora una fonte dati. Scegline una nella scheda «Dati».",
  "not-jira":
    "Solo i progetti collegati a Jira si possono leggere da qui. I dati di esempio si caricano con «npm run seed».",
  "no-credentials":
    "Manca il token di Jira. Inseriscilo nella scheda «Dati»: senza, non c'è modo di autenticarsi.",
  "no-account-email":
    "Manca l'indirizzo dell'account Atlassian. Jira autentica con la coppia indirizzo + token, e da solo il token non basta.",
  "bad-configuration":
    "La configurazione di Jira non è completa o non è valida. Riaprila nella scheda «Dati» e salvala di nuovo.",
  "secrets-unavailable":
    "Questa installazione non ha una chiave di custodia (SECRETS_KEY), quindi non può leggere le credenziali conservate.",
};

export type SynchroniseInput = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly settings: SafeProjectSettings;
  readonly asOf: Date;
  readonly db: Database;

  /**
   * The HTTP implementation, injected.
   *
   * §6 forbids connector tests from making real calls, and a test of *this*
   * function is a connector test in every respect that matters.
   */
  readonly httpFetch?: typeof fetch;

  /**
   * Ignora il cursore e richiedi tutta la storia.
   *
   * La via d'uscita per chi si accorge di non vedere dati che su Jira ci sono:
   * il cursore fa chiedere solo le novità, e se il portale è rimasto indietro
   * per una configurazione sbagliata quelle novità non bastano a recuperare.
   */
  readonly full?: boolean;
};

export async function synchroniseProject(input: SynchroniseInput): Promise<SyncOutcome> {
  const { organizationId, projectId, settings, asOf, db } = input;

  if (settings.connector === null) return refuse("no-connector");
  if (settings.connector !== "jira") return refuse("not-jira");
  if (!settings.connectorSecret.configured) return refuse("no-credentials");

  const config = jiraConfigSchema.safeParse(settings.connectorConfig);
  if (!config.success) return refuse("bad-configuration");

  const account = jiraAccountSchema.safeParse(settings.connectorConfig);
  if (!account.success) return refuse("no-account-email");

  const apiToken = await revealProjectSecret(organizationId, projectId, "connector", db);
  if (apiToken === null) return refuse("secrets-unavailable");

  const connector = createJiraConnector({
    config: config.data,
    read: createJiraReader({
      config: config.data,
      credentials: { email: account.data.accountEmail, apiToken },
      ...(input.httpFetch ? { httpFetch: input.httpFetch } : {}),
    }),
  });

  try {
    /*
     * Il cursore parte dall'ultima lettura riuscita, non da adesso.
     *
     * `lastSyncedAt` è `null` alla prima volta, e il contratto legge
     * `since: undefined` come «prendi tutto». È la lettura che costa di più ed è
     * anche l'unica che può esistere all'inizio: fingere un cursore
     * significherebbe partire con una storia che comincia a metà, e ogni prima
     * transizione risulterebbe venire da uno stato inventato.
     *
     * `full` lo scavalca di proposito: è la richiesta esplicita di chi si è
     * accorto che il portale è rimasto indietro.
     */
    const since = input.full ? null : settings.lastSyncedAt;

    const batch = await connector.fetch({
      organizationId,
      projectId,
      asOf,
      ...(since ? { since } : {}),
    });

    const report = await ingestBatch({ organizationId, projectId, batch, db });

    /*
     * Il segnatempo si sposta **solo dopo** che le righe sono dentro.
     *
     * Spostarlo prima, o insieme, farebbe sì che una lettura fallita a metà
     * lasci il cursore avanti: la parte non scritta non verrebbe più richiesta,
     * e mancherebbe per sempre senza che nulla la segnali.
     */
    await markSynchronised(organizationId, projectId, asOf, db);

    /*
     * La sonda parte **solo** quando non è arrivato nulla.
     *
     * È una chiamata in più a Jira, quindi va spesa dove serve: chi legge un
     * progetto che funziona non deve pagarla, e chi si trova davanti a un
     * portale vuoto merita una risposta invece di un elenco di ipotesi.
     */
    if ((report.counts["elementi di lavoro"] ?? 0) > 0) {
      return { status: "done", report, at: asOf };
    }

    const diagnosis = await diagnoseEmptyRead({
      probe: createJiraProbe({
        config: config.data,
        credentials: { email: account.data.accountEmail, apiToken },
        ...(input.httpFetch ? { httpFetch: input.httpFetch } : {}),
      }),
      configuredKey: config.data.projectKey,
      projectId,
      ...(since ? { since } : {}),
    });

    return { status: "done", report, at: asOf, diagnosis };
  } catch (error) {
    /*
     * L'errore si registra con il contesto e si riferisce senza dettagli.
     *
     * Il messaggio di un fallimento HTTP può contenere l'indirizzo del sito e
     * frammenti della risposta; farlo arrivare in una pagina significherebbe
     * pubblicare la forma dell'installazione di un cliente. Chi amministra lo
     * trova nel registro, chi guarda la schermata sa che non ha funzionato e
     * che riprovare è sicuro.
     */
    logger.error("sincronizzazione fallita", {
      projectId,
      projectKey: config.data.projectKey,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "failed",
      message:
        "La lettura da Jira non è riuscita. Il dettaglio è nel registro del server. " +
        "Riprovare è sicuro: una sincronizzazione ripetuta non duplica nulla.",
    };
  }
}

function refuse(reason: SyncRefusal): SyncOutcome {
  return { status: "refused", reason, message: REFUSALS[reason] };
}

type DiagnosisInput = {
  readonly probe: () => Promise<readonly { readonly key: string }[]>;
  readonly configuredKey: string;
  readonly projectId: ProjectId;
  readonly since?: Date;
};

/**
 * Perché una lettura riuscita non ha portato elementi.
 *
 * L'ordine delle domande non è casuale: si parte da quella che si può
 * sbagliare senza accorgersene (la chiave) e si scende verso quella che non è
 * un errore affatto (un progetto nuovo, ancora vuoto).
 */
async function diagnoseEmptyRead(input: DiagnosisInput): Promise<EmptyReadDiagnosis> {
  const configured = input.configuredKey.trim().toUpperCase();

  let visible: readonly string[];

  try {
    visible = (await input.probe()).map((project) => project.key.toUpperCase());
  } catch (error) {
    /*
     * Una sonda che fallisce non fa fallire nulla.
     *
     * La sincronizzazione è **già riuscita** e le righe sono già scritte: far
     * risalire questo errore trasformerebbe un successo con zero elementi in un
     * fallimento, cioè mentirebbe su ciò che è appena successo.
     */
    logger.warn("sonda sui progetti visibili non riuscita", {
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });

    return { kind: "unknown" };
  }

  if (visible.length === 0) return { kind: "nothing-visible" };
  if (!visible.includes(configured)) {
    return { kind: "key-not-visible", configured, visible };
  }

  /*
   * La chiave è giusta, e allora la domanda diventa un'altra.
   *
   * Su una lettura incrementale «zero elementi» non è un sintomo: è la risposta
   * normale quando nessuno ha toccato nulla dall'ultima volta. Dirlo come se
   * fosse un guasto manderebbe a cercare un problema che non c'è.
   */
  if (input.since) {
    return { kind: "incremental-window", configured, since: input.since };
  }

  return { kind: "key-visible", configured };
}

/**
 * How a completed synchronisation reads on a screen.
 *
 * Here rather than in a component because it is a sentence about numbers, and
 * §4 keeps components free of decisions. It also has to be testable: «letto
 * nulla» and «letto 0 elementi» are different claims, and only one of them is
 * true when a project is already up to date.
 */
export function describeReport(report: IngestReport, diagnosis?: EmptyReadDiagnosis): string {
  if (report.total === 0) {
    return "Non c'era niente di nuovo da leggere: il progetto era già aggiornato.";
  }

  const parts = Object.entries(report.counts)
    .filter(([, count]) => count > 0)
    .map(([entity, count]) => `${count} ${entity}`);

  const letti = `Letti ${parts.join(", ")}.`;

  /*
   * Zero elementi di lavoro si dice, invece di ometterlo.
   *
   * **Il difetto che questa riga ripara.** L'elenco mostra solo ciò che ha
   * righe, quindi una lettura che porta la board e lo sprint ma nessuna issue
   * produce «Letti 1 board, 1 sprint» — una frase che suona come un successo e
   * lascia chi la legge davanti a un portale vuoto, senza sapere se il portale
   * abbia cercato, se abbia trovato zero, o se qualcosa non abbia funzionato.
   */
  if ((report.counts["elementi di lavoro"] ?? 0) > 0) return letti;

  return `${letti} ${explainEmptyRead(diagnosis)}`;
}

/**
 * La frase che accompagna una lettura senza elementi.
 *
 * Separata da `describeReport` perché è l'unica parte che dipende da una
 * domanda fatta alla rete, e perché ciascun caso merita di essere leggibile per
 * intero senza scorrere gli altri.
 */
function explainEmptyRead(diagnosis?: EmptyReadDiagnosis): string {
  const premessa =
    "Nessun elemento di lavoro, però: la lettura è riuscita e Jira ha risposto che non ce n'è nessuno.";

  switch (diagnosis?.kind) {
    case "key-not-visible":
      /*
       * Il caso in cui il portale può dire qualcosa di preciso, e le chiavi
       * buone si nominano: sapere che quella scritta è sbagliata senza sapere
       * quale sia quella giusta lascia esattamente dove si era.
       */
      return (
        `${premessa} La chiave «${diagnosis.configured}» non è fra quelle che il tuo account vede su questo sito. ` +
        `Quelle visibili sono: ${diagnosis.visible.join(", ")}. ` +
        "Correggi «Chiave del progetto» nella scheda «Dati» e rileggi."
      );

    case "nothing-visible":
      return (
        `${premessa} L'account del token non vede alcun progetto su questo sito: di solito significa che il ` +
        "token appartiene a un altro account, oppure che a quell'account non è stato dato accesso al progetto."
      );

    case "incremental-window":
      // Non è un sintomo: è la risposta normale a «cos'è cambiato da allora».
      return (
        `${premessa} La chiave «${diagnosis.configured}» è corretta e il progetto è raggiungibile: questa lettura ` +
        `chiedeva soltanto che cosa fosse cambiato dal ${formatWhen(diagnosis.since)}, e la risposta è «niente».`
      );

    case "key-visible":
      return (
        `${premessa} La chiave «${diagnosis.configured}» è corretta e il tuo account vede il progetto, quindi su Jira ` +
        "quel progetto non contiene ancora alcun ticket. È la risposta normale per uno spazio appena creato: crea un " +
        "elemento in Jira, mettilo nello sprint, e rileggi."
      );

    default:
      /*
       * Nessuna diagnosi, quindi si torna a dire le tre cause.
       *
       * Succede quando la domanda a Jira non ha ricevuto risposta. Inventare
       * una certezza qui sarebbe il modo più veloce per mandare qualcuno a
       * cercare nel posto sbagliato.
       */
      return (
        `${premessa} Di solito è una di tre cose — il progetto Jira è ancora vuoto, la chiave del progetto nelle ` +
        "impostazioni non è quella giusta, oppure l'account del token non vede quel progetto."
      );
  }
}

/** La data come la scriverebbe chi la legge, non come la scrive una macchina. */
function formatWhen(when: Date): string {
  return when.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });
}
