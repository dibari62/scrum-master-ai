import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  organizationIdSchema,
  userIdSchema,
  type OrganizationId,
  type OrganizationRole,
  type UserId,
} from "@/domain";

import type { Database } from "./client";
import { memberships, organizations, userCredentials, users } from "./schema";

/**
 * Queries that cannot go through the tenant scope of `src/db/tenant.ts`.
 *
 * At sign-in there is no tenant yet: the organization is discovered *from* the
 * user, so scoping the lookup by organization would be circular. `users` is
 * not a domain table and carries no `organization_id`, so §8.4 does not apply
 * to it — but everything reached from here does, which is why these functions
 * return identifiers and nothing else of substance.
 */

export type SignInRecord = {
  readonly id: UserId;
  readonly email: string;
  readonly name: string | null;
  readonly passwordHash: string;
};

/**
 * Loads the verifier for an address, or `null` when no account has one.
 *
 * A user who signed up through GitHub has no row in `user_credentials`, so the
 * inner join correctly yields nothing: an OAuth-only account must not be
 * reachable with an empty password.
 */
export async function findUserForSignIn(
  db: Database,
  email: string,
): Promise<SignInRecord | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: userCredentials.passwordHash,
    })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Parsed, not cast: a branded type asserted into existence proves nothing,
  // while this actually checks what the column returned.
  return { ...row, id: userIdSchema.parse(row.id) };
}

export type ActiveMembership = {
  readonly organizationId: OrganizationId;
  readonly role: OrganizationRole;
};

/**
 * The organization a session starts in.
 *
 * Read once when the token is issued, not on every request: that is the whole
 * point of the JWT session in ADR-0006. A user belonging to several
 * organizations lands in the oldest one and switches explicitly.
 */
export async function findInitialMembership(
  db: Database,
  userId: UserId,
): Promise<ActiveMembership | null> {
  const rows = await db
    .select({ organizationId: memberships.organizationId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(memberships.createdAt)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { organizationId: organizationIdSchema.parse(row.organizationId), role: row.role };
}

export type RegistrationInput = {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
};

export type RegistrationResult = {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
};

/**
 * Creates an organization, its first user, the password verifier and the owner
 * membership — all or nothing.
 *
 * `db.batch` rather than `db.transaction`: the Neon HTTP driver has no
 * interactive transactions, but it does send a batch as a single server-side
 * transaction. That forces the identifiers to be known up front, which is why
 * they are generated here instead of being read back from `DEFAULT`.
 *
 * Atomicity is not a nicety here. A half-applied registration leaves either an
 * organization nobody can enter or a user with a password and no tenant, and
 * both look like a working account to whoever tries to sign in.
 */
export async function createOrganizationWithOwner(
  db: Database,
  input: RegistrationInput,
): Promise<RegistrationResult> {
  const organizationId = randomUUID();
  const userId = randomUUID();

  await db.batch([
    db.insert(organizations).values({
      id: organizationId,
      name: input.organizationName,
      slug: input.organizationSlug,
    }),
    db.insert(users).values({
      id: userId,
      email: input.email,
      name: input.name,
    }),
    db.insert(userCredentials).values({ userId, passwordHash: input.passwordHash }),
    db.insert(memberships).values({ organizationId, userId, role: "owner" }),
  ]);

  return {
    organizationId: organizationIdSchema.parse(organizationId),
    userId: userIdSchema.parse(userId),
  };
}
