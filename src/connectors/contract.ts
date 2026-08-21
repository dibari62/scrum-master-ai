import type {
  Board,
  BoardColumn,
  Comment,
  Impediment,
  OrganizationId,
  Person,
  ProjectId,
  PullRequest,
  SourceSystem,
  Sprint,
  SprintScopeEvent,
  StateTransition,
  WorkItem,
} from "@/domain";

/**
 * The contract every connector satisfies, real or synthetic.
 *
 * ADR-0003 makes this the point of the whole design: a connector translates
 * **towards** the canonical model and exposes nothing else. A `JiraIssue` or a
 * `GitHubIssue` lives inside its own folder and never crosses this boundary.
 *
 * The consequence worth stating plainly: the `seed` connector satisfies the
 * same contract as a real integration, so metrics, dashboards and skills can be
 * built and tested before anyone obtains a single OAuth credential.
 */

/**
 * A batch of canonical records, ready to be reconciled into the database.
 *
 * Plain arrays rather than a stream: a connector produces what fits in memory
 * for one synchronisation window, and a window too large to hold is a window
 * that should have been split.
 */
export type CanonicalBatch = {
  readonly people: readonly Person[];
  readonly boards: readonly Board[];
  readonly boardColumns: readonly BoardColumn[];
  readonly sprints: readonly Sprint[];
  readonly workItems: readonly WorkItem[];
  /** The raw material of almost every metric (ADR-0003). */
  readonly transitions: readonly StateTransition[];
  readonly scopeEvents: readonly SprintScopeEvent[];
  readonly comments: readonly Comment[];
  readonly impediments: readonly Impediment[];
  readonly pullRequests: readonly PullRequest[];
};

export const EMPTY_BATCH: CanonicalBatch = {
  people: [],
  boards: [],
  boardColumns: [],
  sprints: [],
  workItems: [],
  transitions: [],
  scopeEvents: [],
  comments: [],
  impediments: [],
  pullRequests: [],
};

export type FetchOptions = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;

  /**
   * Synchronisation cursor: fetch only what changed since this instant.
   *
   * `undefined` requests a full backfill. A connector must treat a backfill as
   * restartable — an interruption halfway through leaves reconcilable records
   * behind, never a half-written state, because reconciliation keys on
   * `(organizationId, sourceSystem, sourceId)` and repeats harmlessly.
   */
  readonly since?: Date | undefined;
};

export type Connector = {
  readonly system: SourceSystem;

  /**
   * Produces canonical records.
   *
   * Calling it twice with the same arguments must produce the same records:
   * ingestion is expected to be idempotent, and a connector that invents new
   * identifiers on every run would duplicate everything instead.
   */
  fetch(options: FetchOptions): Promise<CanonicalBatch>;
};

/** Every entity in a batch carries these, whatever its type. */
export type SourceIdentified = {
  readonly sourceSystem: SourceSystem;
  readonly sourceId: string;
};

/**
 * Flattens a batch into one list, for checks that apply to every record
 * regardless of its kind.
 */
export function allRecords(batch: CanonicalBatch): readonly SourceIdentified[] {
  return [
    ...batch.people,
    ...batch.boards,
    ...batch.boardColumns,
    ...batch.sprints,
    ...batch.workItems,
    ...batch.transitions,
    ...batch.scopeEvents,
    ...batch.comments,
    ...batch.impediments,
    ...batch.pullRequests,
  ];
}
