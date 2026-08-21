import { z } from "zod";

import {
  auditFields,
  descriptionSchema,
  displayNameSchema,
  projectScopedFields,
  timestampSchema,
} from "./common";
import {
  boardColumnIdSchema,
  boardIdSchema,
  commentIdSchema,
  impedimentIdSchema,
  personIdSchema,
  pullRequestIdSchema,
  workItemIdSchema,
} from "./ids";
import { sourceFields } from "./source";
import { workItemStateSchema } from "./work-item";

/**
 * Supporting entities of the canonical model: the board, the people, and the
 * records that explain why work moved the way it did.
 */

/** A column of the board, mapped onto a canonical `WorkItemState`. */
export const boardColumnSchema = z.object({
  id: boardColumnIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  boardId: boardIdSchema,
  name: displayNameSchema,

  /**
   * The canonical state this column represents.
   *
   * Several columns may map to the same state — "In review" and "Waiting for
   * QA" are both `in_review` — which is exactly the mapping ADR-0003 requires
   * to be declarative and per-project rather than hard-coded.
   */
  state: workItemStateSchema,

  /** Position on the board, left to right. */
  position: z.number().int().nonnegative(),

  /**
   * Work-in-progress limit the team set for the column, when it set one.
   *
   * Kept because a column persistently over its own limit is a bottleneck the
   * team already agreed to avoid — a far stronger signal than a threshold we
   * would invent ourselves.
   */
  wipLimit: z.number().int().positive().nullable(),

  ...auditFields,
});

export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const boardSchema = z.object({
  id: boardIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  name: displayNameSchema,
  ...auditFields,
});

export type Board = z.infer<typeof boardSchema>;

/**
 * A team member as they appear in the ingested sources.
 *
 * Distinct from `User`, who signs in to the portal: the two often are the same
 * human but never the same record, and conflating them would tie ingestion to
 * having an account here.
 *
 * **Pseudonymisable by design** (glossary §2): `displayName` is the only
 * identifying field, so replacing it is enough to anonymise a data set.
 */
export const personSchema = z.object({
  id: personIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  displayName: displayNameSchema,

  /**
   * `null` when the source does not expose it, or when it was deliberately
   * dropped. Never required: a person can be referenced without it.
   */
  email: z.string().trim().toLowerCase().pipe(z.email()).nullable(),

  ...auditFields,
});

export type Person = z.infer<typeof personSchema>;

/**
 * Text attached to a work item.
 *
 * **Untrusted content.** Comments are written by third parties, so §8.1 applies
 * in full: this text is data, never instruction. It must never reach a model
 * without explicit delimiting, and must never be able to trigger a tool call.
 */
export const commentSchema = z.object({
  id: commentIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  workItemId: workItemIdSchema,
  authorId: personIdSchema.nullable(),
  body: z.string().max(20_000),
  postedAt: timestampSchema,

  ...auditFields,
});

export type Comment = z.infer<typeof commentSchema>;

/**
 * Something slowing the team down.
 *
 * Separate from a `blocked` work item: an impediment can outlive the item that
 * revealed it, and can affect several at once.
 */
export const impedimentSchema = z.object({
  id: impedimentIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  title: displayNameSchema.max(500),
  description: descriptionSchema,

  /** The item that surfaced it, when there is one. */
  workItemId: workItemIdSchema.nullable(),

  raisedAt: timestampSchema,
  /** `null` while still open. */
  resolvedAt: timestampSchema.nullable(),

  ...auditFields,
});

export type Impediment = z.infer<typeof impedimentSchema>;

export function isImpedimentOpen(impediment: Impediment): boolean {
  return impediment.resolvedAt === null;
}

/**
 * A proposed change to the code.
 *
 * Present in T1 because `reviewWaitTime` — the gap between opening a pull
 * request and its first review comment — is one of the required metrics, and
 * it is often where a sprint actually stalls.
 */
export const pullRequestSchema = z.object({
  id: pullRequestIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  title: displayNameSchema.max(500),
  authorId: personIdSchema.nullable(),

  /** The item this change belongs to, when the link is recoverable. */
  workItemId: workItemIdSchema.nullable(),

  openedAt: timestampSchema,

  /**
   * First review comment. `null` while nobody has looked at it — which is
   * precisely the state `reviewWaitTime` exists to measure.
   */
  firstReviewAt: timestampSchema.nullable(),

  mergedAt: timestampSchema.nullable(),
  closedAt: timestampSchema.nullable(),

  ...auditFields,
});

export type PullRequest = z.infer<typeof pullRequestSchema>;
