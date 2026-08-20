import { z } from "zod";

import { auditFields } from "./common";
import { membershipIdSchema, organizationIdSchema, userIdSchema } from "./ids";

/**
 * Roles a `User` can hold inside an `Organization`.
 *
 * Ordered from most to least capable. Kept to three because a proof of concept
 * that cannot articulate what a fourth role would be allowed to do does not
 * need one; the enum is the single place to extend when it can.
 */
export const organizationRoleSchema = z.enum(["owner", "admin", "member"]);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/** Descending capability. Used to answer "does this role reach that bar?". */
const ROLE_RANK: Readonly<Record<OrganizationRole, number>> = {
  owner: 30,
  admin: 20,
  member: 10,
};

/**
 * True when `role` is at least as capable as `required`.
 *
 * A comparison helper rather than a scattered set of `===` checks: adding a
 * role later must not mean hunting down every authorisation site.
 */
export function roleAtLeast(role: OrganizationRole, required: OrganizationRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/**
 * `Membership` is the link between a `User` and an `Organization`, carrying the
 * role (glossary §1). It is what makes a user's access to a tenant explicit and
 * revocable: no membership, no visibility, with no exception anywhere else.
 *
 * A user holds at most one membership per organization; the database enforces
 * that with a unique constraint on the pair, which a schema cannot express.
 */
export const membershipSchema = z.object({
  id: membershipIdSchema,
  organizationId: organizationIdSchema,
  userId: userIdSchema,
  role: organizationRoleSchema,
  ...auditFields,
});

export type Membership = z.infer<typeof membershipSchema>;

/**
 * Invitation payload.
 *
 * `organizationId` is absent on purpose: the target tenant comes from the
 * authenticated session, never from the request body. Accepting it here would
 * let a caller name an organization they do not belong to, which is precisely
 * the class of bug §8.4 exists to prevent.
 */
export const createMembershipInputSchema = z.object({
  userId: userIdSchema,
  role: organizationRoleSchema,
});

export type CreateMembershipInput = z.infer<typeof createMembershipInputSchema>;

export const updateMembershipInputSchema = membershipSchema.pick({ role: true });

export type UpdateMembershipInput = z.infer<typeof updateMembershipInputSchema>;
