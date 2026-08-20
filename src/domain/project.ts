import { z } from "zod";

import { auditFields, descriptionSchema, displayNameSchema, slugSchema } from "./common";
import { organizationIdSchema, projectIdSchema } from "./ids";

/**
 * A project is archived rather than deleted: sprints, work items and metrics
 * already computed on it stay meaningful, and a deletion would silently
 * rewrite the historical series the whole product is built on.
 */
export const projectStatusSchema = z.enum(["active", "archived"]);

export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/**
 * `Project` is a company initiative that warrants a Scrum Master, and the
 * container for sprints, work items and integrations (glossary §1). An
 * organization holds N of them, which is the shape the product is sold on.
 *
 * `organizationId` is not optional and never inferred: it is the tenant key
 * every read is filtered by (§8.4).
 */
export const projectSchema = z.object({
  id: projectIdSchema,
  organizationId: organizationIdSchema,
  name: displayNameSchema,
  /** Unique within the organization, not globally: two tenants may both run "checkout". */
  slug: slugSchema,
  description: descriptionSchema,
  status: projectStatusSchema,
  ...auditFields,
});

export type Project = z.infer<typeof projectSchema>;

/**
 * Fields the creation form supplies.
 *
 * `organizationId` is excluded for the same reason as in `Membership`: the
 * tenant comes from the session. `status` is excluded because a project is
 * always born active; archiving is a separate, deliberate action.
 */
export const createProjectInputSchema = projectSchema.pick({
  name: true,
  slug: true,
  description: true,
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectInputSchema = projectSchema
  .pick({ name: true, slug: true, description: true, status: true })
  .partial();

export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
