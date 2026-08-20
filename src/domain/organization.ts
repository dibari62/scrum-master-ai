import { z } from "zod";

import { auditFields, displayNameSchema, slugSchema } from "./common";
import { organizationIdSchema } from "./ids";

/**
 * `Organization` is the tenant: the company that registers on the portal and
 * the root of every other record (glossary §1). Nothing in the domain exists
 * outside an organization, which is why §8.4 can require a single scoped
 * access path instead of a filter repeated at each call site.
 *
 * Not to be confused with `Team`, which is a group of people inside a project.
 */
export const organizationSchema = z.object({
  id: organizationIdSchema,
  name: displayNameSchema,
  /** Unique across the whole platform: it appears in URLs. */
  slug: slugSchema,
  ...auditFields,
});

export type Organization = z.infer<typeof organizationSchema>;

/** Fields supplied when a company registers. Identifier and audit fields are ours. */
export const createOrganizationInputSchema = organizationSchema.pick({
  name: true,
  slug: true,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const updateOrganizationInputSchema = organizationSchema
  .pick({ name: true, slug: true })
  .partial();

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInputSchema>;
