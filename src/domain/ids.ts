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

export const sprintIdSchema = identifier<"SprintId">();
export const workItemIdSchema = identifier<"WorkItemId">();
export const stateTransitionIdSchema = identifier<"StateTransitionId">();
export const estimateChangeIdSchema = identifier<"EstimateChangeId">();
export const boardIdSchema = identifier<"BoardId">();
export const boardColumnIdSchema = identifier<"BoardColumnId">();
export const personIdSchema = identifier<"PersonId">();
export const commentIdSchema = identifier<"CommentId">();
export const impedimentIdSchema = identifier<"ImpedimentId">();
export const pullRequestIdSchema = identifier<"PullRequestId">();

export const scrumAgentIdSchema = identifier<"ScrumAgentId">();
export const projectContextIdSchema = identifier<"ProjectContextId">();
export const skillRunIdSchema = identifier<"SkillRunId">();
export const sprintHealthCheckIdSchema = identifier<"SprintHealthCheckId">();

export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type MembershipId = z.infer<typeof membershipIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;

export type SprintId = z.infer<typeof sprintIdSchema>;
export type WorkItemId = z.infer<typeof workItemIdSchema>;
export type StateTransitionId = z.infer<typeof stateTransitionIdSchema>;
export type EstimateChangeId = z.infer<typeof estimateChangeIdSchema>;
export type BoardId = z.infer<typeof boardIdSchema>;
export type BoardColumnId = z.infer<typeof boardColumnIdSchema>;
export type PersonId = z.infer<typeof personIdSchema>;
export type CommentId = z.infer<typeof commentIdSchema>;
export type ImpedimentId = z.infer<typeof impedimentIdSchema>;
export type PullRequestId = z.infer<typeof pullRequestIdSchema>;

export type ScrumAgentId = z.infer<typeof scrumAgentIdSchema>;
export type ProjectContextId = z.infer<typeof projectContextIdSchema>;
export type SkillRunId = z.infer<typeof skillRunIdSchema>;
export type SprintHealthCheckId = z.infer<typeof sprintHealthCheckIdSchema>;
