import { projectSchema, type OrganizationId, type ProjectId } from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { readProjectSettings } from "@/db/project-settings";
import { isDue } from "@/lib/jobs/due";
import { logger } from "@/lib/logger";
import { synchroniseProject } from "@/lib/projects/sync";

/**
 * La lettura che riparte da sola.
 *
 * **Che cosa aggiunge, e che cosa no.** Non aggiunge aritmetica: le metriche si
 * calcolano già a ogni apertura di pagina, dai dati che ci sono. Aggiunge il
 * fatto che i dati arrivino **senza che nessuno se ne ricordi** — che era
 * l'unico pezzo mancante fra «il portale sa leggere Jira» e «il portale è
 * aggiornato».
 *
 * **Non chiama alcun modello e non spende in token.** Un modello che parte da
 * solo, a pagamento, perché è scattato un timer è esattamente ciò che un budget
 * dichiarato esiste per impedire (§9). Questo job muove righe, e le righe non
 * costano.
 *
 * **Spende però la quota di chiamate del cliente sul suo Jira**, ed è la ragione
 * per cui nessun progetto è schedulato finché qualcuno non lo chiede: il
 * predefinito è `manual`.
 *
 * Separato dalla rotta che lo innesca, come l'altro job: decidere quali progetti
 * siano scaduti non ha niente a che vedere con una richiesta HTTP, e una rotta
 * non si prova senza un framework.
 */

export type ProjectSyncOutcome = {
  readonly projectId: ProjectId;
  readonly slug: string;
  readonly status: "done" | "failed" | "refused";
  /** Quante righe sono entrate, quando la lettura è arrivata in fondo. */
  readonly rows: number;
};

export type SyncSummary = {
  /** Quanti progetti sono stati guardati. */
  readonly projectsExamined: number;
  /** Quanti erano scaduti secondo il loro ritmo. */
  readonly projectsDue: number;
  readonly outcomes: readonly ProjectSyncOutcome[];
};

/**
 * Rilegge i progetti scaduti di **una** organizzazione.
 *
 * Prende l'organizzazione invece di ciclarle tutte dentro, come il job della
 * salute: lo scope per tenant si costruisce per organizzazione, e costruirlo
 * anche qui metterebbe la regola di isolamento in due posti (§8.4).
 */
export async function synchroniseOrganization(
  organizationId: OrganizationId,
  asOf: Date,
): Promise<SyncSummary> {
  const db = getDatabase();
  const scope = forOrganization(db, organizationId);

  const projectRows = await scope.reads.projects();

  const outcomes: ProjectSyncOutcome[] = [];
  let examined = 0;
  let due = 0;

  for (const projectRow of projectRows) {
    const project = projectSchema.parse(projectRow);
    examined += 1;

    const settings = await readProjectSettings(organizationId, project.id, db);

    if (!isDue({ schedule: settings.syncSchedule, lastSyncedAt: settings.lastSyncedAt, now: asOf })) {
      continue;
    }

    due += 1;

    /*
     * Un progetto che fallisce non ferma gli altri.
     *
     * Un token scaduto su un progetto è una faccenda di quel progetto: farlo
     * risalire interromperebbe il giro e lascerebbe indietro tutti quelli che
     * vengono dopo in ordine alfabetico — un guasto che colpisce chi non
     * c'entra, e che si manifesta come «i miei dati sono fermi da giorni».
     */
    try {
      const outcome = await synchroniseProject({
        organizationId,
        projectId: project.id,
        settings,
        asOf,
        db,
      });

      outcomes.push({
        projectId: project.id,
        slug: project.slug,
        status: outcome.status === "done" ? "done" : outcome.status === "failed" ? "failed" : "refused",
        rows: outcome.status === "done" ? outcome.report.total : 0,
      });

      if (outcome.status !== "done") {
        /*
         * Un rifiuto si registra con la ragione, ma **senza** la configurazione.
         *
         * «Manca il token» è utile a chi legge i log del server; l'indirizzo del
         * sito di un cliente non lo è, e finirebbe in un registro che
         * sopravvive alla sessione (§8.3).
         */
        logger.warn("sincronizzazione schedulata non riuscita", {
          projectId: project.id,
          status: outcome.status,
          reason: outcome.status === "refused" ? outcome.reason : "errore",
        });
      }
    } catch (error) {
      logger.error("sincronizzazione schedulata interrotta", {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error),
      });

      outcomes.push({ projectId: project.id, slug: project.slug, status: "failed", rows: 0 });
    }
  }

  return { projectsExamined: examined, projectsDue: due, outcomes };
}
