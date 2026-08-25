import type {
  Board,
  BoardColumn,
  Comment,
  EstimateChange,
  Impediment,
  OrganizationId,
  Person,
  ProjectId,
  PullRequest,
  SourceSystem,
  Sprint,
  SprintScopeEvent,
  SprintStatistics,
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
  /**
   * What each item was sized at, and when (ADR-0008).
   *
   * A connector whose source exposes only the current estimate emits **one**
   * change at the item's creation instant. That is a complete answer to what it
   * can observe, not a placeholder: velocity then reads the same figure it
   * would have read anyway, and no re-estimate is silently attributed to a
   * moment nobody recorded.
   */
  readonly estimateChanges: readonly EstimateChange[];
  readonly scopeEvents: readonly SprintScopeEvent[];
  /**
   * The forecast recorded for each sprint, when the source keeps one.
   *
   * Empty for a connector reading a tool that has no such artefact, which is
   * most of them: a forecast is something a team *writes down*, not something
   * a board can be asked for. An absent forecast is a legitimate answer and
   * must never be replaced by a computed one — see
   * `src/domain/sprint-statistics.ts`.
   */
  readonly sprintStatistics: readonly SprintStatistics[];
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
  estimateChanges: [],
  scopeEvents: [],
  sprintStatistics: [],
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

  /**
   * The instant the synchronisation is considered to happen.
   *
   * **Why the window has two ends.** With only `since`, the window is open on
   * the right: a record created while the fetch is running may or may not be
   * included, so two runs over the same cursor can disagree and the next
   * cursor has no defensible value. Closing it makes an ingestion a statement
   * about a stated interval, which is the only form that can be repeated or
   * checked.
   *
   * It is also what keeps the synthetic connector honest. It generates a story
   * rather than reading one, and without an upper bound it would happily emit
   * events dated tomorrow.
   *
   * Passed in, never read from the clock, for the reason ADR-0002 gives.
   */
  readonly asOf: Date;
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
    ...batch.estimateChanges,
    ...batch.scopeEvents,
    ...batch.comments,
    ...batch.impediments,
    ...batch.pullRequests,
  ];
}
