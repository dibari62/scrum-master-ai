import { index, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { projectStatusSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns, organizations } from "./organizations";

/** Generated from the Zod enum for the same reason as `organizationRole`. */
export const projectStatus = pgEnum("project_status", enumValues(projectStatusSchema));

/**
 * A company initiative that warrants a Scrum Master, and the container for
 * sprints, work items and integrations.
 *
 * `organizationId` is the tenant key: `src/db/tenant.ts` filters every read on
 * it, and the index below is what keeps that filter cheap.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    /**
     * Unique per organization, not globally: two unrelated companies must both
     * be able to run a project called "checkout". A global unique constraint
     * would leak the existence of another tenant's project through a
     * conflict error.
     */
    unique("projects_organization_slug_key").on(table.organizationId, table.slug),
    index("projects_organization_id_idx").on(table.organizationId),
  ],
);
