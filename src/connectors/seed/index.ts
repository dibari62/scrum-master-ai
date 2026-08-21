import type { CanonicalBatch, Connector, FetchOptions } from "../contract";

import { generateSeedBatch } from "./generate";

/**
 * The synthetic connector.
 *
 * ADR-0003 treats it as a first-class member rather than a testing aid: it
 * satisfies the same contract as a real integration, so metrics, dashboards and
 * skills are built and verified before anyone obtains an OAuth credential. When
 * a real source replaces it, nothing downstream should need to change — and if
 * something does, the canonical model was wrong.
 *
 * It is also the reference implementation the conformance suite is written
 * against.
 */
export const seedConnector: Connector = {
  system: "seed",

  fetch: async (options: FetchOptions): Promise<CanonicalBatch> => {
    const batch = generateSeedBatch({
      organizationId: options.organizationId,
      projectId: options.projectId,
    });

    // `since` is honoured rather than ignored: a connector that quietly returns
    // everything on an incremental request would make a synchronisation cursor
    // meaningless, and the conformance suite would have nothing to check.
    if (!options.since) return batch;

    const cutoff = options.since.getTime();
    const changedAfter = (instant: Date): boolean => instant.getTime() >= cutoff;

    return {
      ...batch,
      transitions: batch.transitions.filter((t) => changedAfter(t.occurredAt)),
      scopeEvents: batch.scopeEvents.filter((e) => changedAfter(e.occurredAt)),
      comments: batch.comments.filter((c) => changedAfter(c.postedAt)),
      workItems: batch.workItems.filter((w) => changedAfter(w.updatedAt)),
    };
  },
};

export { generateSeedBatch } from "./generate";
export type { GenerateOptions } from "./generate";
