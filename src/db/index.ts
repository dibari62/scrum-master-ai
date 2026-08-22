/**
 * Public surface of the persistence layer.
 *
 * The application imports `forOrganization` and works inside a tenant scope.
 * `getDatabase` is exported for the composition root and for migrations only:
 * anything that takes a bare `Database` has stepped outside the guarantee of
 * AGENTS.md §8.4.
 */

export { createDatabase, getDatabase, type Database } from "./client";
export {
  createOrganizationWithOwner,
  findInitialMembership,
  findUserForSignIn,
  type ActiveMembership,
  type RegistrationInput,
  type RegistrationResult,
  type SignInRecord,
} from "./users";
export {
  forOrganization,
  MAX_SKILL_RUN_PAGE_SIZE,
  type TenantReadName,
  type TenantScope,
  type TenantWriteName,
} from "./tenant";
export * as schema from "./schema";
