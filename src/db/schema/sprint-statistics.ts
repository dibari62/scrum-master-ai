import { index, integer, pgEnum, pgTable, real, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { forecastMethodSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { projectScopedColumns } from "./shared-columns";
import { sprints } from "./sprints";

/**
 * The sprint statistics document (book, chapter 16).
 *
 * **Only the forecast lives here.** The actual velocity is derived from the
 * metrics engine at read time, because it is stable and storing it would create
 * a second source of truth that can drift. The forecast is stored because it
 * cannot be recovered: recomputing it later re-decides it with data that did
 * not exist at the time. See `src/domain/sprint-statistics.ts` for the full
 * argument — there is no `actual_velocity` column here on purpose.
 */

export const forecastMethod = pgEnum("forecast_method", enumValues(forecastMethodSchema));

export const sprintStatistics = pgTable(
  "sprint_statistics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),

    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull(),

    /**
     * `real` and not `integer`: a forecast is an average of past sprints, and
     * averages have decimals. Rounding at write time would throw away precision
     * the reader may want and would make the same figure differ from the one
     * the engine computes.
     */
    forecastPoints: real("forecast_points").notNull(),

    method: forecastMethod("method").notNull(),

    /** `null` for yesterday's weather, which never computes one. */
    focusFactor: real("focus_factor"),

    teamSize: integer("team_size").notNull(),
    workingDays: integer("working_days").notNull(),

    ...auditColumns,
  },
  (table) => [
    /**
     * One forecast per sprint.
     *
     * A sprint forecast twice would leave two rows and no way to say which the
     * team planned against — and "the most recent" is the wrong answer, because
     * a later one was made with knowledge the plan never had.
     */
    unique("sprint_statistics_sprint_key").on(table.sprintId),
    index("sprint_statistics_project_id_idx").on(table.projectId),
  ],
);
