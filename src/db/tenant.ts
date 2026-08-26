import { and, desc, eq, sql } from "drizzle-orm";

import type {
  CreateMembershipInput,
  CreateProjectInput,
  EstimationScale,
  HealthFinding,
  HealthVerdict,
  OrganizationId,
  ProjectId,
  SprintId,
  UpdateProjectInput,
  UserId,
  WorkItemId,
} from "@/domain";

import type { Database } from "./client";
import {
  boardColumns,
  boards,
  comments,
  estimateChanges,
  impediments,
  improvementActions,
  memberships,
  organizations,
  people,
  projectContexts,
  projects,
  pullRequests,
  retrospectiveNotes,
  retrospectives,
  scrumAgents,
  skillRuns,
  sprintHealthChecks,
  sprintReports,
  sprintScopeEvents,
  sprintStatistics,
  sprints,
  stateTransitions,
  workItems,
} from "./schema";

/**
 * What the scheduled check writes.
 *
 * `organizationId` is deliberately absent: it comes from the scope, exactly as
 * it does for every other write here (§8.4). A caller that could name an
 * organization is the shape of bug the shared helper exists to prevent.
 */
export type RecordHealthCheckInput = {
  readonly projectId: ProjectId;
  readonly sprintId: SprintId;
  readonly takenAt: Date;
  /** The UTC day, as `AAAA-MM-GG`: the key that makes a run idempotent. */
  readonly takenOn: string;
  readonly verdict: HealthVerdict;
  readonly elapsedFraction: number;
  readonly findings: readonly HealthFinding[];
};

/**
 * The register never returns more than one page (criterio 29).
 *
 * A ceiling rather than a suggestion: the run register is the one table that
 * grows without bound, and an unpaginated read of it would eventually fetch a
 * project's whole history over an HTTP driver on a free tier.
 */
export const MAX_SKILL_RUN_PAGE_SIZE = 50;

/**
 * Reports are far heavier than runs: each carries its whole snapshot.
 *
 * A smaller page for the same reason the register has one — the card shows the
 * recent ones, and fetching a project's entire reporting history over an HTTP
 * driver on a free tier is a page that eventually stops loading.
 */
export const MAX_SPRINT_REPORT_PAGE_SIZE = 10;

/**
 * A sprint lasts weeks, and the check runs daily: thirty rows covers any sprint
 * with room to spare, and caps a read that would otherwise grow with the
 * project's whole history.
 */
export const MAX_HEALTH_CHECK_PAGE_SIZE = 30;

/**
 * Tenant-scoped access to the database.
 *
 * AGENTS.md §8.4 requires every read to be filtered by organization **at the
 * level of a shared helper, not at individual call sites**. The reason is
 * arithmetic: a filter repeated at a hundred call sites needs to be right a
 * hundred times, while a filter applied here needs to be right once. Cross
 * tenant leaks are not caused by ignorance of the rule, they are caused by the
 * one query written in a hurry that forgot it.
 *
 * So the rest of the application never receives a bare `Database`. It receives
 * a scope built from an organization already established by the session, and
 * the organization is baked into every statement this file produces.
 *
 * Reads return Drizzle query builders rather than awaited rows: it keeps
 * composition open for the caller, and it lets `tests/db/tenant-isolation.test.ts`
 * inspect the generated SQL of every read without a live database.
 */
export function forOrganization(db: Database, organizationId: OrganizationId) {
  const reads = {
    /** The tenant itself. Filtered by id, so a wrong scope returns nothing. */
    organization: () =>
      db.select().from(organizations).where(eq(organizations.id, organizationId)),

    projects: () =>
      db.select().from(projects).where(eq(projects.organizationId, organizationId)),

    projectById: (projectId: ProjectId) =>
      db
        .select()
        .from(projects)
        .where(
          and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)),
        ),

    /**
     * Slugs are unique per organization, so the tenant predicate is not an
     * optimisation here: without it this lookup would return another
     * company's project.
     */
    projectBySlug: (slug: string) =>
      db
        .select()
        .from(projects)
        .where(and(eq(projects.organizationId, organizationId), eq(projects.slug, slug))),

    memberships: () =>
      db
        .select()
        .from(memberships)
        .where(eq(memberships.organizationId, organizationId)),

    membershipByUserId: (userId: UserId) =>
      db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
          ),
        ),

    /**
     * Canonical Scrum data.
     *
     * Each read carries the tenant predicate even where a project or sprint
     * identifier would already narrow the result. That is deliberate: the
     * identifier arrives from a caller, and a caller that passed a foreign one
     * would otherwise read another company's data. The predicate turns a
     * mistake into an empty result instead of a leak.
     */

    sprints: () =>
      db.select().from(sprints).where(eq(sprints.organizationId, organizationId)),

    sprintById: (sprintId: SprintId) =>
      db
        .select()
        .from(sprints)
        .where(and(eq(sprints.organizationId, organizationId), eq(sprints.id, sprintId))),

    sprintsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(sprints)
        .where(
          and(
            eq(sprints.organizationId, organizationId),
            eq(sprints.projectId, projectId),
          ),
        )
        .orderBy(sprints.startsAt),

    workItemsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.projectId, projectId),
          ),
        ),

    workItemsBySprint: (sprintId: SprintId) =>
      db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.sprintId, sprintId),
          ),
        ),

    /**
     * A single item.
     *
     * Filtered by organization as well as by id, so a caller holding an
     * identifier from another tenant gets nothing rather than the row. The
     * identifier is a UUID and therefore hard to guess, but "hard to guess" is
     * not an access control (§8.4).
     */
    workItemById: (workItemId: WorkItemId) =>
      db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.id, workItemId),
          ),
        ),

    /**
     * One item's history, oldest first.
     *
     * Ordering happens in the database because the index covers exactly this
     * pair of columns; sorting in memory would throw that away.
     */
    transitionsByWorkItem: (workItemId: WorkItemId) =>
      db
        .select()
        .from(stateTransitions)
        .where(
          and(
            eq(stateTransitions.organizationId, organizationId),
            eq(stateTransitions.workItemId, workItemId),
          ),
        )
        .orderBy(stateTransitions.occurredAt),

    /** Whole-project history: what burndown and throughput scan. */
    transitionsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(stateTransitions)
        .where(
          and(
            eq(stateTransitions.organizationId, organizationId),
            eq(stateTransitions.projectId, projectId),
          ),
        )
        .orderBy(stateTransitions.occurredAt),

    /**
     * A project's estimate history, in order.
     *
     * Read whole rather than per sprint because velocity needs the estimate an
     * item carried when it *entered* a sprint, and that change may predate the
     * sprint by weeks — a window around the sprint would miss it and silently
     * report the item as never estimated.
     */
    estimateChangesByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(estimateChanges)
        .where(
          and(
            eq(estimateChanges.organizationId, organizationId),
            eq(estimateChanges.projectId, projectId),
          ),
        )
        .orderBy(estimateChanges.occurredAt),

    /** The forecasts recorded for this project's sprints, one per sprint. */
    sprintStatisticsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(sprintStatistics)
        .where(
          and(
            eq(sprintStatistics.organizationId, organizationId),
            eq(sprintStatistics.projectId, projectId),
          ),
        )
        .orderBy(sprintStatistics.recordedAt),

    /** The retrospectives held on this project, oldest first. */
    retrospectivesByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(retrospectives)
        .where(
          and(
            eq(retrospectives.organizationId, organizationId),
            eq(retrospectives.projectId, projectId),
          ),
        )
        .orderBy(retrospectives.heldAt),

    /** Every note of this project's retrospectives. */
    retrospectiveNotesByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(retrospectiveNotes)
        .where(
          and(
            eq(retrospectiveNotes.organizationId, organizationId),
            eq(retrospectiveNotes.projectId, projectId),
          ),
        ),

    /**
     * Every improvement this project has decided, whatever its state.
     *
     * Read whole rather than per retrospective: the question that matters is
     * «cosa è ancora aperto», and it spans meetings by definition — an
     * improvement decided three sprints ago and never closed is exactly the one
     * worth surfacing.
     */
    improvementActionsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(improvementActions)
        .where(
          and(
            eq(improvementActions.organizationId, organizationId),
            eq(improvementActions.projectId, projectId),
          ),
        ),

    scopeEventsBySprint: (sprintId: SprintId) =>
      db
        .select()
        .from(sprintScopeEvents)
        .where(
          and(
            eq(sprintScopeEvents.organizationId, organizationId),
            eq(sprintScopeEvents.sprintId, sprintId),
          ),
        )
        .orderBy(sprintScopeEvents.occurredAt),

    /** Every membership change in a project: what a dashboard needs in one read. */
    scopeEventsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(sprintScopeEvents)
        .where(
          and(
            eq(sprintScopeEvents.organizationId, organizationId),
            eq(sprintScopeEvents.projectId, projectId),
          ),
        )
        .orderBy(sprintScopeEvents.occurredAt),

    /**
     * The people a project's data mentions.
     *
     * Ordered alphabetically **in the database**, and the order is not
     * cosmetic. Without an `ORDER BY` Postgres returns rows in whatever order
     * it finds them, so the roster would reshuffle between two reloads of the
     * same page; and any order derived from the data itself — most recent,
     * most active — would read as a ranking of people, which §8.2 forbids this
     * product to produce. Alphabetical is the one order that says nothing
     * about anybody.
     */
    peopleByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(people)
        .where(
          and(eq(people.organizationId, organizationId), eq(people.projectId, projectId)),
        )
        .orderBy(people.displayName),

    /**
     * The boards of a project, and their columns.
     *
     * Two reads rather than a join: a project usually has one board, and the
     * columns are the interesting part. Joining would repeat the board on every
     * column row and force the caller to undo the repetition.
     *
     * Columns come back in board order — `position`, left to right — because
     * that order *is* the workflow. Sorting them by name, or leaving them
     * unsorted, would show «Concluso» before «In lavorazione» and quietly
     * misrepresent the sequence the team actually follows.
     */
    boardsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(boards)
        .where(
          and(eq(boards.organizationId, organizationId), eq(boards.projectId, projectId)),
        )
        .orderBy(boards.name),

    boardColumnsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(boardColumns)
        .where(
          and(
            eq(boardColumns.organizationId, organizationId),
            eq(boardColumns.projectId, projectId),
          ),
        )
        .orderBy(boardColumns.position),

    commentsByWorkItem: (workItemId: WorkItemId) =>
      db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.organizationId, organizationId),
            eq(comments.workItemId, workItemId),
          ),
        )
        .orderBy(comments.postedAt),

    impedimentsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(impediments)
        .where(
          and(
            eq(impediments.organizationId, organizationId),
            eq(impediments.projectId, projectId),
          ),
        )
        /*
         * Il più recente per primo, e l'ordine è stabilito qui.
         *
         * Senza un `ORDER BY` Postgres restituisce le righe nell'ordine in cui
         * le trova, quindi due ricariche della stessa pagina mostrerebbero un
         * elenco rimescolato — un difetto che non fa fallire nulla e che chi
         * legge attribuisce a sé stesso.
         */
        .orderBy(desc(impediments.raisedAt)),

    pullRequestsByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.organizationId, organizationId),
            eq(pullRequests.projectId, projectId),
          ),
        ),

    /**
     * The Scrum Master AI and its register.
     *
     * The tenant predicate is what turns criterio 5 into a property of the
     * helper rather than a habit of every caller: a user of organization B
     * asking for the agent of a project of organization A reads nothing, in
     * exactly the same way as if the agent did not exist. "Not found" and "not
     * yours" have to be indistinguishable, and they are indistinguishable
     * because the query cannot tell them apart either.
     */

    /** At most one row: `scrum_agents_project_key` guarantees it. */
    scrumAgentByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(scrumAgents)
        .where(
          and(
            eq(scrumAgents.organizationId, organizationId),
            eq(scrumAgents.projectId, projectId),
          ),
        ),

    /**
     * The context is read on its own and not joined to the agent: it is scoped
     * to the project, it exists independently of the agent's status, and the
     * card shows the two as separate sections.
     */
    projectContextByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(projectContexts)
        .where(
          and(
            eq(projectContexts.organizationId, organizationId),
            eq(projectContexts.projectId, projectId),
          ),
        ),

    /**
     * The run register: most recent first, one page at a time (criterio 29).
     *
     * A caller asking for more than a page gets a page. Clamping rather than
     * throwing because the limit is a protection, not a validation of user
     * input: the worst outcome of a wrong argument should be a shorter list,
     * never a failed page. Ordering and limiting happen in the database, on the
     * index that covers exactly these three columns.
     */
    skillRunsByProject: (projectId: ProjectId, limit: number = MAX_SKILL_RUN_PAGE_SIZE) =>
      db
        .select()
        .from(skillRuns)
        .where(
          and(
            eq(skillRuns.organizationId, organizationId),
            eq(skillRuns.projectId, projectId),
          ),
        )
        .orderBy(desc(skillRuns.startedAt))
        .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_SKILL_RUN_PAGE_SIZE)),

    /**
     * Sprint reports, most recent first.
     *
     * Regenerating adds a report rather than replacing one (spec §11 Q3):
     * deleting is irreversible and accumulating is not, so the history stays and
     * the card shows the head of it.
     */
    sprintReportsByProject: (projectId: ProjectId, limit = MAX_SPRINT_REPORT_PAGE_SIZE) =>
      db
        .select()
        .from(sprintReports)
        .where(
          and(
            eq(sprintReports.organizationId, organizationId),
            eq(sprintReports.projectId, projectId),
          ),
        )
        .orderBy(desc(sprintReports.generatedAt))
        .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_SPRINT_REPORT_PAGE_SIZE)),

    /**
     * The kept judgements on a sprint, oldest first.
     *
     * Ascending, unlike every other register here, because this one is read as
     * a line rather than as a list: the question is how the verdict moved, and
     * a trend told backwards has to be reversed by whoever draws it.
     */
    healthChecksBySprint: (sprintId: SprintId, limit = MAX_HEALTH_CHECK_PAGE_SIZE) =>
      db
        .select()
        .from(sprintHealthChecks)
        .where(
          and(
            eq(sprintHealthChecks.organizationId, organizationId),
            eq(sprintHealthChecks.sprintId, sprintId),
          ),
        )
        .orderBy(sprintHealthChecks.takenAt)
        .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_HEALTH_CHECK_PAGE_SIZE)),
  } as const;

  const writes = {
    /**
     * `organizationId` comes from the scope, never from the input: that is why
     * `CreateProjectInput` does not carry one.
     */
    createProject: (input: CreateProjectInput) =>
      db.insert(projects).values({ ...input, organizationId }).returning(),

    updateProject: (projectId: ProjectId, input: UpdateProjectInput) =>
      db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)),
        )
        .returning(),

    addMembership: (input: CreateMembershipInput) =>
      db.insert(memberships).values({ ...input, organizationId }).returning(),

    removeMembership: (userId: UserId) =>
      db
        .delete(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
          ),
        )
        .returning(),

    /**
     * Switches **one** capability on or off, without touching the others.
     *
     * **Why it works this way.** Turning a single switch used to mean reading
     * the whole set, changing one element and writing the set back. That works
     * while only one capability can be switched on; with two, the read and the
     * write are a gap in which the set is decided, and enabling one capability
     * silently switched the other off.
     *
     * Here the database does the change in a single statement, on the value it
     * holds at that moment. There is no set carried across a round trip, so
     * there is nothing to overwrite with a stale copy. The bulk writer that used
     * to sit here was deleted rather than kept beside this one: an unused way to
     * overwrite the whole set is a ready-made way to reintroduce the fault.
     *
     * `- key` before the concatenation is what keeps the list free of
     * duplicates: removing first makes enabling something already enabled a
     * no-op rather than a second entry.
     */
    setSkillEnabled: (projectId: ProjectId, key: string, enabled: boolean) =>
      db
        .update(scrumAgents)
        .set({
          /*
           * I cast sono espliciti, e non è pignoleria.
           *
           * `jsonb - ?` è ambiguo: Postgres conosce `jsonb - text` (togli la
           * chiave), `jsonb - integer` (togli la posizione) e `jsonb - text[]`.
           * Con un parametro di tipo non dichiarato la scelta dipende dal
           * piano, e la variante sbagliata non solleva un errore: restituisce
           * un risultato diverso. Il sintomo era una capacità che ne spegneva
           * un'altra invece di affiancarsi.
           */
          enabledSkillKeys: enabled
            ? sql`(coalesce(${scrumAgents.enabledSkillKeys}, '[]'::jsonb) - ${key}::text) || ${JSON.stringify([key])}::jsonb`
            : sql`coalesce(${scrumAgents.enabledSkillKeys}, '[]'::jsonb) - ${key}::text`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(scrumAgents.organizationId, organizationId),
            eq(scrumAgents.projectId, projectId),
          ),
        )
        .returning(),

    /**
     * Records a judgement on a running sprint, one per sprint per day.
     *
     * An upsert rather than an insert, because criterio 6 asks for one row per
     * day and two runs on the same date describe the same day. Drawing two
     * points would suggest a change that never happened.
     *
     * The conflict target is the constraint the schema declares, so the rule is
     * enforced by the database rather than by whoever remembers it.
     */
    recordHealthCheck: (input: RecordHealthCheckInput) =>
      db
        .insert(sprintHealthChecks)
        .values({ ...input, organizationId })
        .onConflictDoUpdate({
          target: [sprintHealthChecks.sprintId, sprintHealthChecks.takenOn],
          set: {
            takenAt: input.takenAt,
            verdict: input.verdict,
            elapsedFraction: input.elapsedFraction,
            findings: [...input.findings],
            updatedAt: new Date(),
          },
        })
        .returning(),

    /**
     * Declares which scale this team estimates on.
     *
     * A single column on a single row, updated where it stands, for the same
     * reason `setSkillEnabled` works that way: reading the context, changing
     * one field and writing the whole card back would let a concurrent edit of
     * the Definition of Done be overwritten by a copy read a moment earlier.
     *
     * The organization is part of the `where`, not of the caller's diligence
     * (§8.4).
     */
    setEstimationScale: (projectId: ProjectId, scale: EstimationScale) =>
      db
        .update(projectContexts)
        .set({ estimationScale: scale, updatedAt: new Date() })
        .where(
          and(
            eq(projectContexts.organizationId, organizationId),
            eq(projectContexts.projectId, projectId),
          ),
        )
        .returning(),
  } as const;

  return { organizationId, reads, writes } as const;
}

export type TenantScope = ReturnType<typeof forOrganization>;

/** Every read exposed by a scope. The isolation test must cover all of them. */
export type TenantReadName = keyof TenantScope["reads"];

/** Every write exposed by a scope. The isolation test must cover all of them. */
export type TenantWriteName = keyof TenantScope["writes"];
