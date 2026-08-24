import { organizationIdSchema } from "@/domain";
import { getDatabase } from "@/db";
import { organizations } from "@/db/schema";
import { authoriseJob } from "@/lib/jobs/authorise";
import { checkOrganizationHealth } from "@/lib/jobs/sprint-health-check";
import { logger } from "@/lib/logger";

/**
 * The scheduled check, over HTTP.
 *
 * Deliberately thin: it authorises, establishes the instant, and delegates.
 * Everything that decides anything lives in `src/lib/jobs`, which is plain
 * functions and therefore testable — a route handler cannot be called by a unit
 * test without a framework and a request.
 *
 * **`POST` and not `GET`.** It writes. A `GET` that changes data will
 * eventually be fetched by a link checker, a prefetcher or a crawler, and the
 * job will appear to have run on its own.
 *
 * The instant comes from here, once, and is passed down: the metrics engine
 * still never reads the clock, and every judgement written by one run describes
 * the same moment (ADR-0002).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authorisation = authoriseJob(request.headers);

  if (!authorisation.ok) {
    /*
     * Due esiti diversi, due codici diversi, e nessuno dei due dice altro.
     *
     * Un segreto non configurato è un errore del server, non di chi chiama:
     * rispondere `401` manderebbe chi ha impostato lo schedulatore a cercare il
     * problema dalla parte sbagliata. Nessuna delle due risposte rivela quale
     * fosse il valore atteso, quanto sia lungo, o quanto ci sia andato vicino.
     */
    if (authorisation.reason === "misconfigured") {
      logger.error("job.sprint-health.misconfigured", {
        message: "JOB_SECRET non impostata: la rotta rifiuta ogni chiamata.",
      });

      return Response.json({ error: "Job non configurato." }, { status: 500 });
    }

    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  const asOf = new Date();

  /*
   * Ogni azienda, una alla volta.
   *
   * Le organizzazioni si leggono senza uno scope per tenant — è l'unico punto
   * dell'applicazione in cui è corretto, perché il job non serve una sessione:
   * non c'è un'azienda «corrente» di cui rispettare i confini, c'è l'elenco di
   * quelle da visitare. Ogni visita costruisce poi il proprio scope, e da lì in
   * poi vale la regola di sempre.
   */
  const rows = await getDatabase().select({ id: organizations.id }).from(organizations);

  let projectsExamined = 0;
  let checksRecorded = 0;

  for (const row of rows) {
    const summary = await checkOrganizationHealth(
      organizationIdSchema.parse(row.id),
      asOf,
    );

    projectsExamined += summary.projectsExamined;
    checksRecorded += summary.checksRecorded;
  }

  logger.info("job.sprint-health.done", {
    organizations: rows.length,
    projectsExamined,
    checksRecorded,
  });

  return Response.json({
    takenAt: asOf.toISOString(),
    organizations: rows.length,
    projectsExamined,
    checksRecorded,
  });
}
