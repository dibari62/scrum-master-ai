import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { workItemKindSchema, workItemStateSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { projectScopedColumns, sourceColumns } from "./shared-columns";
import { sprints } from "./sprints";

/** Generated from the Zod enums, so the two lists cannot disagree (R4). */
export const workItemKind = pgEnum("work_item_kind", enumValues(workItemKindSchema));
export const workItemState = pgEnum("work_item_state", enumValues(workItemStateSchema));

/**
 * People as they appear in the ingested sources.
 *
 * Declared here rather than with the other collaboration tables because work
 * items reference it, and a table must exist before something points at it.
 */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    /** The only identifying field: replacing it anonymises the data set. */
    displayName: text("display_name").notNull(),
    email: text("email"),

    ...auditColumns,
  },
  (table) => [
    unique("people_source_key").on(table.projectId, table.sourceSystem, table.sourceId),
    index("people_project_id_idx").on(table.projectId),
  ],
);

/** Story, bug, task, epic or spike: the kind is a field, not a separate table. */
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    kind: workItemKind("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),

    /**
     * Current state as reported by the source.
     *
     * Convenient for drawing a board; metrics must not read it. They derive
     * from `state_transitions`, the only record of how and when the item got
     * here (ADR-0003).
     */
    state: workItemState("state").notNull(),

    /**
     * Estimate split into value and unit.
     *
     * Two columns rather than one number, because a team estimating in hours
     * and one estimating in points produce figures that must never be summed
     * together — and a bare number makes that mistake invisible.
     */
    estimateValue: integer("estimate_value"),
    estimateUnit: text("estimate_unit"),

    /** `null` for an item still in the backlog. */
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),

    /**
     * `onDelete: "set null"`: removing a person must not delete their work.
     * The item outlives whoever happened to be assigned to it.
     */
    assigneeId: uuid("assignee_id").references(() => people.id, { onDelete: "set null" }),

    /**
     * Parent item, for a story under an epic.
     *
     * A self-reference, so the return type must be annotated: while the table
     * is still being defined its own type is not yet known.
     *
     * `onDelete: "set null"` rather than cascade — deleting an epic must not
     * delete the stories under it, which are real work.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => workItems.id, {
      onDelete: "set null",
    }),

    /** When the item appeared in the origin system, not when we ingested it. */
    sourceCreatedAt: timestamp("source_created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    ...auditColumns,
  },
  (table) => [
    unique("work_items_source_key").on(
      table.projectId,
      table.sourceSystem,
      table.sourceId,
    ),
    index("work_items_project_id_idx").on(table.projectId),
    /** "What is in this sprint" is the most frequent question metrics ask. */
    index("work_items_sprint_id_idx").on(table.sprintId),
    index("work_items_project_state_idx").on(table.projectId, table.state),
    index("work_items_parent_id_idx").on(table.parentId),
  ],
);

/**
 * The history of state changes: the raw material of almost every flow metric.
 *
 * ADR-0003 makes this a first-class table rather than a detail. Cycle time,
 * blocked time, reopen rate and flow efficiency are all unanswerable from the
 * current state alone.
 */
export const stateTransitions = pgTable(
  "state_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),

    /** `null` only for the first transition, when the item came into existence. */
    fromState: workItemState("from_state"),
    toState: workItemState("to_state").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),

    actorId: uuid("actor_id").references(() => people.id, { onDelete: "set null" }),

    ...auditColumns,
  },
  (table) => [
    unique("state_transitions_source_key").on(
      table.projectId,
      table.sourceSystem,
      table.sourceId,
    ),
    /**
     * The hot path: metrics read one item's history in chronological order.
     * Both columns together, so the database can walk the index instead of
     * fetching rows and sorting them.
     */
    index("state_transitions_item_occurred_idx").on(table.workItemId, table.occurredAt),
    /** Throughput and burndown scan a whole project over a period. */
    index("state_transitions_project_occurred_idx").on(table.projectId, table.occurredAt),
  ],
);
