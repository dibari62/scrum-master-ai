import type { Query } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase, forOrganization, type TenantScope } from "@/db";
import type { TenantReadName, TenantWriteName } from "@/db";
import { organizationIdSchema, projectIdSchema, sprintIdSchema, userIdSchema, workItemIdSchema } from "@/domain";

/**
 * Isolation between two organizations (AGENTS.md §8.4).
 *
 * The check runs on the SQL each helper produces, not on rows fetched from a
 * live server: it needs no database, no network and no credentials, so it runs
 * on every push instead of only where a Neon branch happens to exist. The Neon
 * HTTP driver opens nothing until a statement is awaited, and nothing here is
 * awaited.
 *
 * What it proves is the property that matters: no statement leaves the scope
 * without carrying its tenant.
 */

const CONNECTION = "postgresql://user:password@ep-example-123.eu-central-1.aws.neon.tech/neondb";

const ORGANIZATION_A = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const ORGANIZATION_B = organizationIdSchema.parse("8a2d4f60-1c3b-4e97-8f5a-6b0d2e9c4713");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");
const USER_ID = userIdSchema.parse("7c9e6679-7425-40de-944b-e07fc1f90ae7");
const SPRINT_ID = sprintIdSchema.parse("2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35");
const WORK_ITEM_ID = workItemIdSchema.parse("5e8b1d47-9c2a-4f36-8b71-3d0a6e9f2c48");

const db = createDatabase(CONNECTION);
const scopeA = forOrganization(db, ORGANIZATION_A);
const scopeB = forOrganization(db, ORGANIZATION_B);

/**
 * Every read, with sample arguments.
 *
 * Typed as a total `Record` on purpose: adding a read to the scope without
 * listing it here stops the build. A silent gap in this table would be a read
 * nobody ever checked for tenant scoping.
 */
const READS: Record<TenantReadName, (scope: TenantScope) => Query> = {
  organization: (scope) => scope.reads.organization().toSQL(),
  projects: (scope) => scope.reads.projects().toSQL(),
  projectById: (scope) => scope.reads.projectById(PROJECT_ID).toSQL(),
  projectBySlug: (scope) => scope.reads.projectBySlug("checkout").toSQL(),
  memberships: (scope) => scope.reads.memberships().toSQL(),
  membershipByUserId: (scope) => scope.reads.membershipByUserId(USER_ID).toSQL(),

  sprints: (scope) => scope.reads.sprints().toSQL(),
  sprintById: (scope) => scope.reads.sprintById(SPRINT_ID).toSQL(),
  sprintsByProject: (scope) => scope.reads.sprintsByProject(PROJECT_ID).toSQL(),
  workItemsByProject: (scope) => scope.reads.workItemsByProject(PROJECT_ID).toSQL(),
  workItemsBySprint: (scope) => scope.reads.workItemsBySprint(SPRINT_ID).toSQL(),
  workItemById: (scope) => scope.reads.workItemById(WORK_ITEM_ID).toSQL(),
  transitionsByWorkItem: (scope) =>
    scope.reads.transitionsByWorkItem(WORK_ITEM_ID).toSQL(),
  transitionsByProject: (scope) => scope.reads.transitionsByProject(PROJECT_ID).toSQL(),
  scopeEventsBySprint: (scope) => scope.reads.scopeEventsBySprint(SPRINT_ID).toSQL(),
  scopeEventsByProject: (scope) => scope.reads.scopeEventsByProject(PROJECT_ID).toSQL(),
  peopleByProject: (scope) => scope.reads.peopleByProject(PROJECT_ID).toSQL(),
  commentsByWorkItem: (scope) => scope.reads.commentsByWorkItem(WORK_ITEM_ID).toSQL(),
  impedimentsByProject: (scope) => scope.reads.impedimentsByProject(PROJECT_ID).toSQL(),
  pullRequestsByProject: (scope) => scope.reads.pullRequestsByProject(PROJECT_ID).toSQL(),
};

/** Same contract for writes: an unlisted write breaks the build. */
const WRITES: Record<TenantWriteName, (scope: TenantScope) => Query> = {
  createProject: (scope) =>
    scope.writes
      .createProject({ name: "Checkout", slug: "checkout", description: null })
      .toSQL(),
  updateProject: (scope) =>
    scope.writes.updateProject(PROJECT_ID, { name: "Checkout v2" }).toSQL(),
  addMembership: (scope) =>
    scope.writes.addMembership({ userId: USER_ID, role: "member" }).toSQL(),
  removeMembership: (scope) => scope.writes.removeMembership(USER_ID).toSQL(),
};

const readNames = Object.keys(READS) as ReadonlyArray<TenantReadName>;
const writeNames = Object.keys(WRITES) as ReadonlyArray<TenantWriteName>;

describe("isolamento fra organizzazioni: letture", () => {
  it.each(readNames)("%s è vincolata al tenant dello scope", (name) => {
    const query = READS[name](scopeA);
    expect(query.params).toContain(ORGANIZATION_A);
  });

  it.each(readNames)("%s non trapela il tenant dell'altra organizzazione", (name) => {
    const fromA = READS[name](scopeA);
    const fromB = READS[name](scopeB);

    expect(fromA.params).not.toContain(ORGANIZATION_B);
    expect(fromB.params).not.toContain(ORGANIZATION_A);
    // Stesso SQL, parametri diversi: cambia il tenant, non la forma della query.
    expect(fromA.sql).toBe(fromB.sql);
  });

  it.each(["projects", "projectById", "projectBySlug", "memberships", "membershipByUserId"] as const)(
    "%s filtra esplicitamente su organization_id",
    (name) => {
      expect(READS[name](scopeA).sql).toContain('"organization_id"');
    },
  );
});

describe("isolamento fra organizzazioni: scritture", () => {
  it.each(writeNames)("%s porta con sé il tenant dello scope", (name) => {
    expect(WRITES[name](scopeA).params).toContain(ORGANIZATION_A);
  });

  it("createProject usa il tenant dello scope e non quello del chiamante", () => {
    const query = WRITES.createProject(scopeB);

    expect(query.params).toContain(ORGANIZATION_B);
    expect(query.params).not.toContain(ORGANIZATION_A);
  });

  it.each(["updateProject", "removeMembership"] as const)(
    "%s non può toccare righe di un'altra organizzazione",
    (name) => {
      expect(WRITES[name](scopeA).sql).toContain('"organization_id"');
    },
  );
});

describe("superficie dello scope", () => {
  it("espone il proprio tenant per la registrazione e la diagnostica", () => {
    expect(scopeA.organizationId).toBe(ORGANIZATION_A);
    expect(scopeB.organizationId).toBe(ORGANIZATION_B);
  });
});
