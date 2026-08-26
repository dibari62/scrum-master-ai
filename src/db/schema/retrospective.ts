import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { improvementStatusSchema, retrospectiveColumnSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { projectScopedColumns } from "./shared-columns";
import { sprints } from "./sprints";

/**
 * The retrospective, its notes, and the improvements it decided.
 *
 * Three tables rather than one with arrays: the improvements outlive the
 * meeting. The whole point is that the *next* retrospective looks back at
 * them, which means they need their own status, their own resolution instant
 * and their own identity.
 *
 * **No author column anywhere, on purpose.** A note carrying a name turns «what
 * could have gone better» into a record of who complained, and puts a
 * per-person count one query away (§8.2). The book's format is a wall of
 * anonymous Post-its; this is that wall.
 */

export const retrospectiveColumn = pgEnum(
  "retrospective_column",
  enumValues(retrospectiveColumnSchema),
);

export const improvementStatus = pgEnum(
  "improvement_status",
  enumValues(improvementStatusSchema),
);

export const retrospectives = pgTable(
  "retrospectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),

    heldAt: timestamp("held_at", { withTimezone: true, mode: "date" }).notNull(),

    /** A count, never a roster: it only decides whether votes may be shown. */
    participantCount: integer("participant_count").notNull(),

    ...auditColumns,
  },
  (table) => [
    // Una retrospettiva per sprint: due lascerebbero due verità su cosa la
    // squadra ha deciso di cambiare, senza modo di dire quale vale.
    unique("retrospectives_sprint_key").on(table.sprintId),
    index("retrospectives_project_id_idx").on(table.projectId),
  ],
);

export const retrospectiveNotes = pgTable(
  "retrospective_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    retrospectiveId: uuid("retrospective_id")
      .notNull()
      .references(() => retrospectives.id, { onDelete: "cascade" }),

    column: retrospectiveColumn("column").notNull(),

    /** Untrusted content (§8.1): written by a person, treated as data. */
    text: text("text").notNull(),

    ...auditColumns,
  },
  (table) => [
    index("retrospective_notes_retrospective_idx").on(table.retrospectiveId),
    index("retrospective_notes_project_id_idx").on(table.projectId),
  ],
);

export const improvementActions = pgTable(
  "improvement_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    retrospectiveId: uuid("retrospective_id")
      .notNull()
      .references(() => retrospectives.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    detail: text("detail"),

    /** A total, never a list of voters. */
    votes: integer("votes").notNull().default(0),

    status: improvementStatus("status").notNull().default("open"),

    /**
     * When the outcome was recorded, distinct from `updated_at`.
     *
     * `updated_at` moves for a corrected typo; this is the instant somebody
     * decided the improvement had landed, and the only one from which "how long
     * did it take" can be measured.
     */
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),

    ...auditColumns,
  },
  (table) => [
    index("improvement_actions_retrospective_idx").on(table.retrospectiveId),
    /** «Cosa è ancora aperto» è la domanda che questa tabella esiste per porre. */
    index("improvement_actions_project_status_idx").on(table.projectId, table.status),
  ],
);
