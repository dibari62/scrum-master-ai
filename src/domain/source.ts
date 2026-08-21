import { z } from "zod";

/**
 * Where a canonical record came from.
 *
 * ADR-0003 requires every canonical entity to keep `sourceSystem` and
 * `sourceId`. Without them a record cannot be re-synchronised, a duplicate
 * cannot be recognised on the next ingestion, and a number shown in a report
 * cannot be traced back to the ticket that produced it — which is what makes
 * an `Insight` verifiable rather than merely plausible.
 */

/**
 * Systems a connector can translate from.
 *
 * `seed` is a first-class member, not a testing hack: ADR-0003 makes synthetic
 * data satisfy the same contract as a real integration, which is what lets
 * metrics and skills be built before any OAuth credential exists.
 */
export const sourceSystemSchema = z.enum(["seed", "github", "jira"]);

export type SourceSystem = z.infer<typeof sourceSystemSchema>;

/**
 * The identifier the origin system uses.
 *
 * Kept as an opaque string: Jira issues a key, GitHub a number, and coercing
 * either into the other's shape loses information for no gain.
 */
export const sourceIdSchema = z.string().trim().min(1).max(200);

/**
 * Carried by every entity that came from outside.
 *
 * The pair `(sourceSystem, sourceId)` is unique per project, which is what a
 * connector uses to decide between inserting and updating.
 */
export const sourceFields = {
  sourceSystem: sourceSystemSchema,
  sourceId: sourceIdSchema,
} as const;
