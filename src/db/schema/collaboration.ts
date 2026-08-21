import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns } from "./organizations";
import { projectScopedColumns, sourceColumns } from "./shared-columns";
import { people, workItems, workItemState } from "./work-items";

/** The column view of the workflow. */
export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    name: text("name").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("boards_source_key").on(table.projectId, table.sourceSystem, table.sourceId),
    index("boards_project_id_idx").on(table.projectId),
  ],
);

export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    /**
     * The canonical state this column represents.
     *
     * Several columns may map to the same state — "In review" and "Waiting for
     * QA" are both `in_review`. That mapping is per-project data, not code.
     */
    state: workItemState("state").notNull(),
    position: integer("position").notNull(),

    /**
     * The limit the team set for itself, when it set one.
     *
     * A column persistently over its own limit is a bottleneck the team had
     * already agreed to avoid — a far stronger signal than a threshold we
     * would invent.
     */
    wipLimit: integer("wip_limit"),

    ...auditColumns,
  },
  (table) => [
    unique("board_columns_source_key").on(
      table.projectId,
      table.sourceSystem,
      table.sourceId,
    ),
    index("board_columns_board_id_idx").on(table.boardId),
  ],
);

/**
 * Text attached to a work item.
 *
 * **Untrusted content** (§8.1): written by third parties, so it is data and
 * never instruction. It must never reach a model without explicit delimiting,
 * and must never be able to trigger a tool call.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => people.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "date" }).notNull(),

    ...auditColumns,
  },
  (table) => [
    unique("comments_source_key").on(table.projectId, table.sourceSystem, table.sourceId),
    /** Response-time signals read a thread in order. */
    index("comments_work_item_posted_idx").on(table.workItemId, table.postedAt),
  ],
);

/**
 * Something slowing the team down.
 *
 * Separate from a `blocked` work item: an impediment can outlive the item that
 * revealed it, and can affect several at once.
 */
export const impediments = pgTable(
  "impediments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    title: text("title").notNull(),
    description: text("description"),

    workItemId: uuid("work_item_id").references(() => workItems.id, {
      onDelete: "set null",
    }),

    raisedAt: timestamp("raised_at", { withTimezone: true, mode: "date" }).notNull(),
    /** `null` while still open. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),

    ...auditColumns,
  },
  (table) => [
    unique("impediments_source_key").on(
      table.projectId,
      table.sourceSystem,
      table.sourceId,
    ),
    index("impediments_project_raised_idx").on(table.projectId, table.raisedAt),
  ],
);

/**
 * A proposed change to the code.
 *
 * Present in T1 because `reviewWaitTime` — the gap between opening a pull
 * request and its first review comment — is a required metric, and it is often
 * where a sprint actually stalls.
 */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,
    ...sourceColumns,

    title: text("title").notNull(),
    authorId: uuid("author_id").references(() => people.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, {
      onDelete: "set null",
    }),

    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull(),
    /** `null` while nobody has looked at it — the state the metric measures. */
    firstReviewAt: timestamp("first_review_at", { withTimezone: true, mode: "date" }),
    mergedAt: timestamp("merged_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),

    ...auditColumns,
  },
  (table) => [
    unique("pull_requests_source_key").on(
      table.projectId,
      table.sourceSystem,
      table.sourceId,
    ),
    index("pull_requests_project_opened_idx").on(table.projectId, table.openedAt),
    index("pull_requests_work_item_id_idx").on(table.workItemId),
  ],
);
