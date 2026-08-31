import { createOrganizationWithOwner, getDatabase, type Database } from "@/db";
import type { OrganizationId, SignUpInput, UserId } from "@/domain";

import { hashPassword } from "../password";
import { uniqueViolationOf } from "../unique-violation";

/**
 * Registration of a company and its first user (T0).
 */

/**
 * Constraint names from the migration, mapped to what the interface should
 * say. Matching on the constraint rather than on the message text keeps this
 * from breaking when the server locale or wording changes.
 */
const CONSTRAINT_REASONS = {
  organizations_slug_unique: "organization-slug-taken",
  users_email_unique: "email-taken",
} as const;

export type RegistrationFailureReason =
  (typeof CONSTRAINT_REASONS)[keyof typeof CONSTRAINT_REASONS];

export type RegistrationOutcome =
  | { readonly ok: true; readonly organizationId: OrganizationId; readonly userId: UserId }
  | { readonly ok: false; readonly reason: RegistrationFailureReason };

/**
 * Recognises a collision the interface can explain, or returns `null`.
 *
 * Checking availability before inserting would be a race: two registrations
 * for the same slug can both pass the check and then both insert. The unique
 * constraint is the only real guard, so the error it raises is the signal —
 * this function only translates it.
 *
 * Anything unrecognised stays `null` and is rethrown by the caller: swallowing
 * an unknown database failure as "slug taken" would send the user off fixing
 * the wrong thing (§7).
 */
export function classifyRegistrationError(error: unknown): RegistrationFailureReason | null {
  const constraint = uniqueViolationOf(error, Object.keys(CONSTRAINT_REASONS));
  if (constraint === null) return null;

  return CONSTRAINT_REASONS[constraint as keyof typeof CONSTRAINT_REASONS];
}

/**
 * Creates the organization, its owner and the password verifier.
 *
 * The plaintext password never leaves this function: it is turned into a
 * verifier here and only the verifier reaches the database layer.
 */
export async function registerOrganization(
  input: SignUpInput,
  db: Database = getDatabase(),
): Promise<RegistrationOutcome> {
  const passwordHash = await hashPassword(input.password);

  try {
    const { organizationId, userId } = await createOrganizationWithOwner(db, {
      organizationName: input.organizationName,
      organizationSlug: input.organizationSlug,
      name: input.name,
      email: input.email,
      passwordHash,
    });

    return { ok: true, organizationId, userId };
  } catch (error) {
    const reason = classifyRegistrationError(error);
    if (!reason) throw error;

    return { ok: false, reason };
  }
}
