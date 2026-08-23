import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { reportOriginSchema, type MetricSnapshot, type ReportContent } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { scrumAgents, skillRuns } from "./scrum-agent";
import { projectScopedColumns } from "./shared-columns";
import { sprints } from "./sprints";

/**
 * Sprint reports, kept with the numbers they were written from.
 *
 * **The snapshot is stored, not recomputed.** A report reread in three months
 * has to keep saying the same figures; recalculating them on display would let
 * them drift under the reader, which is the one thing a written report must
 * never do. It also means the text and the numbers cannot disagree — the pair is
 * a single row, written once.
 */

export const reportOrigin = pgEnum("report_origin", enumValues(reportOriginSchema));

export const sprintReports = pgTable(
  "sprint_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),

    scrumAgentId: uuid("scrum_agent_id")
      .notNull()
      .references(() => scrumAgents.id, { onDelete: "cascade" }),

    /**
     * The run that produced it.
     *
     * A report without its run would hide what it cost and which provider
     * answered — the two facts that make the price of this product visible.
     */
    skillRunId: uuid("skill_run_id")
      .notNull()
      .references(() => skillRuns.id, { onDelete: "cascade" }),

    /** Whether a model wrote the prose, or the code did for want of anything to say. */
    origin: reportOrigin("origin").notNull(),

    /** The validated output. Shaped by `reportContentSchema`, parsed on read. */
    content: jsonb("content").$type<ReportContent>().notNull(),

    /** Every figure the text was allowed to quote, frozen. */
    snapshot: jsonb("snapshot").$type<MetricSnapshot>().notNull(),

    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull(),

    ...auditColumns,
  },
  (table) => [
    /*
     * The read the card performs: one project's reports, newest first.
     *
     * Descending in the index too, so the most recent report is the head rather
     * than a sort over every report the project ever produced.
     */
    index("sprint_reports_project_generated_idx").on(
      table.organizationId,
      table.projectId,
      table.generatedAt.desc(),
    ),

    /*
     * Regenerating adds a report rather than replacing one (spec §11 Q3), so
     * there is deliberately no uniqueness on the sprint. This index serves the
     * question that is asked instead: what has been written about this sprint.
     */
    index("sprint_reports_sprint_idx").on(table.sprintId, table.generatedAt.desc()),

    /**
     * A report with no figures must not claim a model wrote it.
     *
     * `origin` is the field that keeps a demonstration honest — it says whether
     * the AI was used — and a mistake here would be invisible in the interface
     * while making the product look like it does more than it does.
     */
    check(
      "sprint_reports_origin_check",
      sql`${table.origin} <> 'code' OR jsonb_array_length(${table.snapshot} -> 'values') = 0`,
    ),
  ],
);
