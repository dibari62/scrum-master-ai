import { and, eq } from "drizzle-orm";

import type {
  CreateMembershipInput,
  CreateProjectInput,
  OrganizationId,
  ProjectId,
  UpdateProjectInput,
  UserId,
} from "@/domain";

import type { Database } from "./client";
import { memberships, organizations, projects } from "./schema";

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
