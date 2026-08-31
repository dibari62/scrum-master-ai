import {
  createJiraConnector,
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
  | { readonly status: "done"; readonly report: IngestReport; readonly at: Date }
  | { readonly status: "refused"; readonly reason: SyncRefusal; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

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
     */
    const batch = await connector.fetch({
      organizationId,
      projectId,
      asOf,
      ...(settings.lastSyncedAt ? { since: settings.lastSyncedAt } : {}),
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

    return { status: "done", report, at: asOf };
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

/**
 * How a completed synchronisation reads on a screen.
 *
 * Here rather than in a component because it is a sentence about numbers, and
 * §4 keeps components free of decisions. It also has to be testable: «letto
 * nulla» and «letto 0 elementi» are different claims, and only one of them is
 * true when a project is already up to date.
 */
export function describeReport(report: IngestReport): string {
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
   *
   * Le tre cause probabili sono nominate perché sono verificabili in un minuto
   * ciascuna, e perché nessuna di esse è visibile da questa parte: il portale
   * sa solo che la risposta era vuota.
   */
  if ((report.counts["elementi di lavoro"] ?? 0) > 0) return letti;

  return (
    `${letti} Nessun elemento di lavoro, però: la lettura è riuscita e ` +
    "Jira ha risposto che non ce n'è nessuno. Di solito è una di tre cose — il " +
    "progetto Jira è ancora vuoto, la chiave del progetto nelle impostazioni non " +
    "è quella giusta, oppure l'account del token non vede quel progetto."
  );
}
