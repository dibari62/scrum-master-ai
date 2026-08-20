import { z } from "zod";

/**
 * Branded identifiers.
 *
 * A plain `string` makes every identifier interchangeable, and the most
 * dangerous confusion in a multi-tenant system is passing the wrong one to a
 * query: swapping a `UserId` for an `OrganizationId` compiles fine and leaks
 * data across tenants. Branding turns that into a compile-time error.
 *
 * Values are UUIDs so identifiers can be generated before a database round
 * trip, which keeps the domain free of any persistence concern (ADR-0003).
 *
 * The brand exists only in the type system: nothing distinguishes these values
 * at runtime, which is why the parameter is a type argument and not an
 * argument.
 */
function identifier<Brand extends string>() {
  return z.uuid().brand<Brand>();
}

export const organizationIdSchema = identifier<"OrganizationId">();
export const userIdSchema = identifier<"UserId">();
export const membershipIdSchema = identifier<"MembershipId">();
export const projectIdSchema = identifier<"ProjectId">();

export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type MembershipId = z.infer<typeof membershipIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
