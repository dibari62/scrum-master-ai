import { index, pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { sprintScopeEventKindSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { projectScopedColumns, sourceColumns } from "./shared-columns";
import { sprints } from "./sprints";
import { workItems } from "./work-items";

export const sprintScopeEventKind = pgEnum(
  "sprint_scope_event_kind",
  enumValues(sprintScopeEventKindSchema),
);

/**
 * When an item entered or left a sprint.
 *
 * Exists because two required metrics cannot be computed without it:
 * `scopeChange` is defined as work added or removed **after** the sprint
 * started, and `carryOver` needs to know the item was in the previous sprint.
 * The `sprint_id` column on `work_items` answers "where is it now" and loses
 * both — the same reason `state_transitions` exists rather than trusting the
 * current state.
 */
export const sprintScopeEvents = pgTable(
  "sprint_scope_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),

    kind: sprintScopeEventKind("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),

    ...auditColumns,
  },
  (table) => [
    unique("sprint_scope_events_source_key").on(
      table.projectId,
      table.sourceSystem,
      table.sourceId,
    ),
    /** Scope change reads one sprint's events in chronological order. */
    index("sprint_scope_events_sprint_occurred_idx").on(table.sprintId, table.occurredAt),
    index("sprint_scope_events_work_item_id_idx").on(table.workItemId),
  ],
);
