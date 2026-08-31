import {
  projectSchema,
  type CreateProjectInput,
  type OrganizationId,
  type OrganizationRole,
  type Project,
} from "@/domain";
import { forOrganization, getDatabase, type Database } from "@/db";

import { uniqueViolationOf } from "../unique-violation";

/**
 * Creating a project.
 *
 * Lives in `src/lib` rather than beside the page for the same reason as
 * `agents/scrum-agent.ts`: a server action cannot be loaded by a test — its
 * identifier is generated at build time — so anything that decides something
 * must not live inside one. Here it is plain functions over plain data, called
 * by a thin action.
 */

/**
 * Who may create a project.
 *
 * The same answer, and the same argument, as `mayConfigureAgent`: granting a
 * permission later disturbs nobody, revoking one takes something away from
 * whoever had started using it, so in the Product Owner's absence the
 * restrictive reading wins. A project is also not a daily operation — it is the
 * container every sprint, work item and metric hangs from, and it is archived
 * rather than deleted, so a mistaken one stays visible for good.
 */
const MAY_CREATE: ReadonlySet<OrganizationRole> = new Set(["owner", "admin"]);

export function mayCreateProject(role: OrganizationRole | null | undefined): boolean {
  return role !== null && role !== undefined && MAY_CREATE.has(role);
}

/** The constraint from the migration: slug unique **per organization**. */
const SLUG_CONSTRAINT = "projects_organization_slug_key";

export type CreateProjectFailureReason = "forbidden" | "slug-taken";

export type CreateProjectOutcome =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly reason: CreateProjectFailureReason };

/**
 * Recognises "this organization already has a project with that slug".
 *
 * The constraint covers the pair `(organization_id, slug)`, so this collision
 * can only ever be with a project of the caller's own company. That is what
 * makes it safe to report at all: a globally unique slug would turn the same
 * message into a way of discovering another tenant's projects (§8.4).
 */
export function classifyProjectError(error: unknown): CreateProjectFailureReason | null {
  return uniqueViolationOf(error, [SLUG_CONSTRAINT]) === null ? null : "slug-taken";
}

/**
 * Writes the project of the organization in `organizationId`.
 *
 * `organizationId` arrives from the session and is handed to the tenant scope,
 * which bakes it into the statement: the payload carries no organization, and a
 * request body that could name one is the shape of defect §8.4 exists to
 * prevent.
 *
 * The role check is repeated here even though the page already hides the way
 * in. A hidden button is not an authorisation: the action is reachable by
 * anyone who can post to it.
 */
export async function createProject(
  input: {
    readonly organizationId: OrganizationId;
    readonly role: OrganizationRole | null | undefined;
    readonly payload: CreateProjectInput;
  },
  db: Database = getDatabase(),
): Promise<CreateProjectOutcome> {
  if (!mayCreateProject(input.role)) return { ok: false, reason: "forbidden" };

  const scope = forOrganization(db, input.organizationId);

  try {
    const [row] = await scope.writes.createProject(input.payload);
    if (!row) {
      // `returning()` on a successful insert always yields the row; no row means
      // the write did not happen, and reporting success would be a lie the list
      // page immediately contradicts.
      throw new Error("La creazione del progetto non ha restituito alcuna riga.");
    }

    // Parsed, not cast: the database returns rows, and trusting their shape
    // would defeat the point of having schemas (R4).
    return { ok: true, project: projectSchema.parse(row) };
  } catch (error) {
    const reason = classifyProjectError(error);
    if (reason === null) throw error;

    return { ok: false, reason };
  }
}
