import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns } from "./organizations";
import { projectScopedColumns, sourceColumns } from "./shared-columns";

/** A fixed-length iteration, with a start, an end and a goal. */
export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    name: text("name").notNull(),
    goal: text("goal"),

    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Distinct from `endsAt`: a sprint closed late is a signal worth keeping. */
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),

    ...auditColumns,
  },
  (table) => [
    /**
     * What a connector matches on to decide between inserting and updating.
     * Scoped to the project rather than global: two projects may legitimately
     * ingest records carrying the same identifier in their own source.
     */
    unique("sprints_source_key").on(table.projectId, table.sourceSystem, table.sourceId),
    index("sprints_project_id_idx").on(table.projectId),
    /** Metrics scan sprints by period far more often than by name. */
    index("sprints_project_starts_at_idx").on(table.projectId, table.startsAt),
  ],
);
