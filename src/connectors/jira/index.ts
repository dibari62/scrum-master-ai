import { logger } from "@/lib/logger";

import type { CanonicalBatch, Connector, FetchOptions } from "../contract";

import type { JiraConfig } from "./config";
import { translateSnapshot } from "./translate";
import type { JiraSnapshot } from "./types";

/**
 * The Jira connector, assembled from two halves that never touch.
 *
 * **Reading** is the half that needs a token, a network and patience with rate
 * limits. **Translating** is the half that holds every rule about what our
 * numbers mean. Keeping them apart is not tidiness: it is the reason the second
 * half can be tested at all. A recorded snapshot is a file, and §6 requires
 * connector tests to run on recorded fixtures rather than real calls.
 *
 * So this module takes the reader as an argument. In production it is HTTP; in
 * tests it is a function that returns a JSON file; in both cases the translation
 * is the same code, which is the only way a test says anything about production.
 */

/** Fetches everything one synchronisation needs, however it likes. */
export type SnapshotReader = (options: FetchOptions) => Promise<JiraSnapshot>;

export type JiraConnectorOptions = {
  readonly config: JiraConfig;
  readonly read: SnapshotReader;
};

export function createJiraConnector(options: JiraConnectorOptions): Connector {
  return {
    system: "jira",

    fetch: async (fetchOptions: FetchOptions): Promise<CanonicalBatch> => {
      const snapshot = await options.read(fetchOptions);

      const { batch, unmappedStatuses } = translateSnapshot({
        organizationId: fetchOptions.organizationId,
        projectId: fetchOptions.projectId,
        config: options.config,
        snapshot,
        asOf: fetchOptions.asOf,
      });

      if (unmappedStatuses.length > 0) {
        /*
         * Segnalato, non taciuto e non fatale.
         *
         * Rifiutare la sincronizzazione perché qualcuno ha aggiunto una colonna
         * spegnerebbe il portale per un atto di ordinaria manutenzione. Tacere
         * sarebbe peggio: `statusCategory` non distingue una coda di revisione
         * dal lavoro attivo, e il ripiego appiattirebbe in silenzio una metrica
         * di flusso.
         */
        logger.warn("stati Jira non mappati: usato il ripiego su statusCategory", {
          statuses: unmappedStatuses,
          projectKey: options.config.projectKey,
        });
      }

      if (!fetchOptions.since) return batch;

      /*
       * Il cursore si applica **dopo** la traduzione, non prima.
       *
       * Le tre storie si ricostruiscono dall'inizio: tagliare il changelog a
       * monte darebbe una prima transizione che parte da uno stato inventato, e
       * ogni storia risulterebbe incoerente. Si traduce tutto ciò che si è
       * letto e si consegna la parte nuova.
       */
      const cutoff = fetchOptions.since.getTime();
      const after = (at: Date): boolean => at.getTime() >= cutoff;

      return {
        ...batch,
        transitions: batch.transitions.filter((entry) => after(entry.occurredAt)),
        estimateChanges: batch.estimateChanges.filter((entry) => after(entry.occurredAt)),
        scopeEvents: batch.scopeEvents.filter((entry) => after(entry.occurredAt)),
        comments: batch.comments.filter((entry) => after(entry.postedAt)),
        workItems: batch.workItems.filter((entry) => after(entry.updatedAt)),
      };
    },
  };
}

export {
  jiraAccountSchema,
  jiraConfigSchema,
  DEFAULT_KIND_MAPPING,
  STATUS_CATEGORY_FALLBACK,
} from "./config";
export type { JiraAccount, JiraConfig } from "./config";
export { translateSnapshot } from "./translate";
export type { TranslationResult } from "./translate";
export { jiraSnapshotSchema } from "./types";
export type { JiraSnapshot } from "./types";
export { createJiraReader } from "./client";
export type { JiraCredentials, JiraReaderOptions } from "./client";
