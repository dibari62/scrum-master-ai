import { and, eq } from "drizzle-orm";

import type {
  CreateMembershipInput,
  CreateProjectInput,
  OrganizationId,
  ProjectId,
  SprintId,
  UpdateProjectInput,
  UserId,
  WorkItemId,
} from "@/domain";

import type { Database } from "./client";
import {
  comments,
  impediments,
  memberships,
  organizations,
  people,
  projects,
  pullRequests,
  sprintScopeEvents,
  sprints,
  stateTransitions,
  workItems,
} from "./schema";

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

    peopleByProject: (projectId: ProjectId) =>
      db
        .select()
        .from(people)
        .where(
          and(eq(people.organizationId, organizationId), eq(people.projectId, projectId)),
        ),

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
        ),

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
  } as const;

  return { organizationId, reads, writes } as const;
}

export type TenantScope = ReturnType<typeof forOrganization>;

/** Every read exposed by a scope. The isolation test must cover all of them. */
export type TenantReadName = keyof TenantScope["reads"];

/** Every write exposed by a scope. The isolation test must cover all of them. */
export type TenantWriteName = keyof TenantScope["writes"];
