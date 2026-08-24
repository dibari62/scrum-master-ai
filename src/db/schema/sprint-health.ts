import { date, index, jsonb, pgEnum, pgTable, real, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { healthVerdictSchema, type HealthFinding } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { projectScopedColumns } from "./shared-columns";
import { sprints } from "./sprints";

/**
 * The kept judgements on running sprints.
 *
 * Written by the scheduled check, never by a page. It exists so the product can
 * answer "how has this changed", which the on-demand calculation cannot: the
 * dashboard works out the health at the moment somebody opens it, so without
 * these rows yesterday's verdict was never computed at all.
 */

export const healthVerdict = pgEnum("health_verdict", enumValues(healthVerdictSchema));

export const sprintHealthChecks = pgTable(
  "sprint_health_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),

    takenAt: timestamp("taken_at", { withTimezone: true, mode: "date" }).notNull(),

    /**
     * The UTC day `takenAt` falls in, stored rather than derived.
     *
     * It is the key that makes a run idempotent, and a uniqueness constraint
     * cannot be built on an expression as portably as on a column. Two runs on
     * the same day update one row instead of drawing two points where nothing
     * changed between them.
     */
    takenOn: date("taken_on").notNull(),

    verdict: healthVerdict("verdict").notNull(),

    /** How much of the sprint had gone, between 0 and 1. */
    elapsedFraction: real("elapsed_fraction").notNull(),

    /** Every finding, frozen: a verdict reread later must keep saying why. */
    findings: jsonb("findings").$type<readonly HealthFinding[]>().notNull(),

    ...auditColumns,
  },
  (table) => [
    /*
     * One judgement per sprint per day.
     *
     * Not an optimisation: it is criterio 6 turned into something the database
     * enforces. A rule about duplicates that lives only in the code that
     * writes is a rule that lasts until a second writer appears.
     */
    unique("sprint_health_checks_day_key").on(table.sprintId, table.takenOn),

    /** The read the dashboard performs: one sprint's history, newest first. */
    index("sprint_health_checks_sprint_idx").on(
      table.organizationId,
      table.sprintId,
      table.takenAt.desc(),
    ),
  ],
);
