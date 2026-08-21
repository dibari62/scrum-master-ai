import { pgEnum, text, uuid } from "drizzle-orm/pg-core";

import { sourceSystemSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { organizations } from "./organizations";
import { projects } from "./projects";

/**
 * Column groups shared by the canonical Scrum tables.
 *
 * Declared once here rather than repeated per table: ten copies of the same
 * four columns drift the moment one of them changes.
 */

/** Generated from the Zod enum, so the two lists cannot disagree (R4). */
export const sourceSystem = pgEnum("source_system", enumValues(sourceSystemSchema));

/**
 * Where a record came from.
 *
 * ADR-0003 requires the pair on every canonical entity: without it a record
 * cannot be matched on the next ingestion, and a number in a report cannot be
 * traced back to the ticket that produced it.
 */
export const sourceColumns = {
  sourceSystem: sourceSystem("source_system").notNull(),
  sourceId: text("source_id").notNull(),
};

/**
 * Tenant and project keys.
 *
 * `organizationId` sits next to `projectId` even though the project implies it.
 * Denormalisation on purpose: the tenant filter of §8.4 then applies to each
 * table directly, without a join whose absence would silently widen a query.
 */
export const projectScopedColumns = {
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
};
