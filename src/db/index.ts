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
  forOrganization,
  type TenantReadName,
  type TenantScope,
  type TenantWriteName,
} from "./tenant";
export * as schema from "./schema";
