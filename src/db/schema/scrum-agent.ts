import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  agentLanguageSchema,
  agentPersonaSchema,
  agentStatusSchema,
  agentToneSchema,
  autonomyLevelSchema,
  estimationScaleSchema,
  llmProviderSchema,
  skillRunFailureCauseSchema,
  skillRunStatusSchema,
  triggerSchema,
  MAX_DEFINITION_OF_DONE_ENTRIES,
  MAX_RUNS_PER_DAY_LIMIT,
  MAX_SPRINT_LENGTH_DAYS,
  MAX_STAKEHOLDERS,
  MAX_TOKEN_BUDGET,
  MAX_WORKING_AGREEMENT_LENGTH,
  MIN_SPRINT_LENGTH_DAYS,
  type ProjectContext,
  type ScrumAgent,
} from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { projectScopedColumns } from "./shared-columns";

/**
 * Persistence of the Scrum Master AI (T3): the agent, the project context it
 * works from, and the register of what it did.
 *
 * **No `source_system` / `source_id` here, on purpose.** R4 asks for the pair on
 * every *ingested* entity, because it is what makes a re-import idempotent.
 * These three are declared inside the application — nobody imports them from
 * Jira — so the columns would carry a constant `seed` value that proves
 * nothing, and the unique key that makes ingestion idempotent lives instead on
 * `project_id` (one agent, one context per project: criteri 2 and 4).
 */

/**
 * Postgres enums generated from the Zod enums (R8): one list, one place.
 *
 * Retyping the values here would create a second definition that drifts on the
 * day someone adds a tone — and the drift only shows up as a failed INSERT in
 * production.
 */
export const agentPersona = pgEnum("agent_persona", enumValues(agentPersonaSchema));
export const agentTone = pgEnum("agent_tone", enumValues(agentToneSchema));
export const agentLanguage = pgEnum("agent_language", enumValues(agentLanguageSchema));
export const agentStatus = pgEnum("agent_status", enumValues(agentStatusSchema));

/**
 * The **full** ladder, not the subset a caller may select today.
 *
 * `selectableAutonomyLevelSchema` is the policy of T3 and it will widen; the
 * stored type is the vocabulary of the domain and must already accept what T5
 * will write, because altering an enum type in Postgres is a migration and
 * refusing to *read* `advise` would be worse than never having stored it.
 */
export const autonomyLevel = pgEnum("autonomy_level", enumValues(autonomyLevelSchema));

/** Generated from the Zod enum, so the deck and the column cannot disagree (R4). */
export const estimationScale = pgEnum("estimation_scale", enumValues(estimationScaleSchema));

/**
 * `Trigger` in the domain, `skill_trigger` as a Postgres type.
 *
 * The only renamed value in this file: `trigger` is a reserved keyword in SQL,
 * and a type that must be quoted everywhere it appears is a trap left for
 * whoever writes the first hand-written query. The Zod enum keeps the glossary
 * name; this is the physical spelling of it.
 */
export const skillTrigger = pgEnum("skill_trigger", enumValues(triggerSchema));

export const skillRunStatus = pgEnum("skill_run_status", enumValues(skillRunStatusSchema));
export const skillRunFailureCause = pgEnum(
  "skill_run_failure_cause",
  enumValues(skillRunFailureCauseSchema),
);
export const llmProvider = pgEnum("llm_provider", enumValues(llmProviderSchema));

/**
 * A number inlined into DDL rather than bound as a parameter.
 *
 * A `CHECK` lives in the schema, and a schema cannot carry `$1`: without
 * `sql.raw` drizzle-kit would emit a placeholder into the migration. The values
 * still come from the domain constants, so the bound in the database and the
 * bound in Zod cannot disagree (R8, R9).
 */
function literal(value: number | string): ReturnType<typeof sql.raw> {
  return sql.raw(typeof value === "number" ? String(value) : `'${value}'`);
}

/**
 * The Scrum Master AI of one project.
 *
 * **Policy on two columns rather than one `jsonb`.** `AgentPolicy` is a closed
 * pair of scalars that the *runtime* enforces on every execution: the daily cap
 * is compared against a count of runs (criterio 27) and the token ceiling
 * against an estimate before the gateway is called (criterio 20). Values the
 * code decides on are values the database can constrain, and the two `CHECK`s
 * below say out loud what `dailyRunLimitSchema` says in Zod — R9 asks for
 * integrity in the database, not only in the code. The precedent is `estimate`
 * on `work_items`: a canonical object on two columns, which is exactly why
 * `toScrumAgentRow` exists in `src/db/rows.ts`.
 */
export const scrumAgents = pgTable(
  "scrum_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    name: text("name").notNull(),
    persona: agentPersona("persona").notNull(),
    tone: agentTone("tone").notNull(),
    language: agentLanguage("language").notNull(),
    autonomyLevel: autonomyLevel("autonomy_level").notNull(),
    status: agentStatus("status").notNull(),

    /**
     * Enabled skills as a `jsonb` array of keys.
     *
     * A list of opaque references, read and written only as a whole with the
     * agent, and never joined against anything: the catalogue is code, not a
     * table, so a join table would point at rows that do not exist. Kept as
     * `text` values rather than the `skill_key` enum for the reason given in
     * `skillKeyReferenceSchema`: a key retired in a later release must still
     * load, and an enum would make the agent unreadable instead.
     */
    enabledSkillKeys: jsonb("enabled_skill_keys")
      .$type<ScrumAgent["enabledSkillKeys"]>()
      .notNull(),

    /** `null` means "do not reduce what the skill declared" — see `AgentPolicy`. */
    maxTokensPerRun: integer("max_tokens_per_run"),
    maxRunsPerDay: integer("max_runs_per_day").notNull(),

    ...auditColumns,
  },
  (table) => [
    /**
     * One agent per project (criterio 2), and the reason a double submit
     * creates one row instead of two (criterio 4): idempotence that survives a
     * retry has to be a constraint, since two concurrent requests both read
     * "no agent yet" before either writes.
     *
     * On `project_id` alone rather than on the pair with the organization: the
     * project already belongs to exactly one tenant, and a wider key would
     * admit a second agent for the same project under a forged organization.
     */
    unique("scrum_agents_project_key").on(table.projectId),

    check(
      "scrum_agents_max_tokens_per_run_check",
      sql`${table.maxTokensPerRun} IS NULL OR (${table.maxTokensPerRun} > 0 AND ${table.maxTokensPerRun} <= ${literal(MAX_TOKEN_BUDGET)})`,
    ),
    check(
      "scrum_agents_max_runs_per_day_check",
      sql`${table.maxRunsPerDay} > 0 AND ${table.maxRunsPerDay} <= ${literal(MAX_RUNS_PER_DAY_LIMIT)}`,
    ),
    /** A `jsonb` column accepts a number or a string; the domain shape is a list. */
    check(
      "scrum_agents_enabled_skill_keys_check",
      sql`jsonb_typeof(${table.enabledSkillKeys}) = 'array'`,
    ),
  ],
);

/**
 * How this team has decided to work.
 *
 * **`ceremonies`, `definition_of_done` and `stakeholders` are `jsonb`; the
 * scalars are columns.** The reasoning, since this is the decision most worth
 * arguing with:
 *
 * 1. *Nothing queries inside them.* No skill of T3 reads them (spec §5), and
 *    none of the metrics of T1 does either. Indexing is meant to follow real
 *    queries, and there are none — "which projects hold a Daily Scrum on
 *    Tuesday" is not a question this product asks.
 * 2. *They are one card, saved as one unit.* `updateProjectContextInput`
 *    carries `expectedUpdatedAt`, and optimistic concurrency only works if the
 *    version covers everything the editor was looking at. Split across child
 *    rows, a conflicting save would be detected on the parent row while the
 *    children were replaced anyway.
 * 3. *The Neon HTTP driver has no interactive transaction.* Replacing a list in
 *    a child table means a delete plus N inserts inside a `db.batch`, on a free
 *    tier that also has to survive a cold start. One row, one statement.
 * 4. *`ceremonies` is exhaustive by construction.* Every Scrum event is present
 *    and an unscheduled one is `null` — the distinction between "not scheduled"
 *    and "not answered" that the card has to show. A child table would have to
 *    reproduce that invariant with five mandatory rows, which is a rule nothing
 *    in the database can state.
 *
 * What this gives up is real and worth naming: the database cannot enforce the
 * `Audience` enum on a stakeholder, nor reject two identical stakeholders, the
 * way a child table with a unique key could. Those two rules stay in
 * `stakeholdersSchema`, and every write goes through it. The `CHECK`s below
 * hold what a `jsonb` column can still hold: shape and size.
 *
 * The size caps are not decoration. This text is free-form, Neon Free gives
 * 0.5 GB per project, and an unbounded paste in a working agreement is the
 * cheapest way to spend it.
 */
export const projectContexts = pgTable(
  "project_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    sprintLengthDays: integer("sprint_length_days").notNull(),

    ceremonies: jsonb("ceremonies").$type<ProjectContext["ceremonies"]>().notNull(),
    definitionOfDone: jsonb("definition_of_done")
      .$type<ProjectContext["definitionOfDone"]>()
      .notNull(),

    /**
     * The scale the team estimates on, `free` when none is declared.
     *
     * A default is required because the column arrives on a table that already
     * has rows, and `free` is the only honest value for a project that was
     * never asked: it reports no deviation, which is what "we did not declare a
     * scale" should do.
     */
    estimationScale: estimationScale("estimation_scale").notNull().default("free"),

    /**
     * **Untrusted content** (§8.1), like every text field on this table: written
     * by a human, stored as data, never as instruction. `null` is "not
     * declared", never the empty string.
     */
    workingAgreement: text("working_agreement"),

    stakeholders: jsonb("stakeholders").$type<ProjectContext["stakeholders"]>().notNull(),

    ...auditColumns,
  },
  (table) => [
    /**
     * One context per project — the constraint `projectContextSchema` says a
     * schema cannot express. Scoped to the project and not to the agent: the
     * way a team works survives the suspension of its Scrum Master AI.
     */
    unique("project_contexts_project_key").on(table.projectId),

    check(
      "project_contexts_sprint_length_days_check",
      sql`${table.sprintLengthDays} BETWEEN ${literal(MIN_SPRINT_LENGTH_DAYS)} AND ${literal(MAX_SPRINT_LENGTH_DAYS)}`,
    ),
    check(
      "project_contexts_definition_of_done_check",
      sql`jsonb_typeof(${table.definitionOfDone}) = 'array' AND jsonb_array_length(${table.definitionOfDone}) <= ${literal(MAX_DEFINITION_OF_DONE_ENTRIES)}`,
    ),
    check(
      "project_contexts_stakeholders_check",
      sql`jsonb_typeof(${table.stakeholders}) = 'array' AND jsonb_array_length(${table.stakeholders}) <= ${literal(MAX_STAKEHOLDERS)}`,
    ),
    check(
      "project_contexts_working_agreement_check",
      sql`${table.workingAgreement} IS NULL OR char_length(${table.workingAgreement}) <= ${literal(MAX_WORKING_AGREEMENT_LENGTH)}`,
    ),
  ],
);

/**
 * One row per execution that reaches the runtime, successful or not
 * (criterio 25).
 *
 * The only place where the cost of the product is visible, which is why a
 * refusal decided by our own rules — budget, daily cap, suspended agent — is a
 * `failed` row and not an absent one.
 *
 * **Retention.** This table is the only one in T3 that grows without a ceiling,
 * on a 0.5 GB tier. The daily cap bounds the rate, and the index below is
 * deliberately the one a retention job needs as well: deleting the runs of an
 * organization older than N days walks the same three columns as the register
 * page. No raw provider payload is stored — only the receipt — so a row stays
 * small enough that the register can be kept for a long time and the payloads
 * for none at all.
 */
export const skillRuns = pgTable(
  "skill_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    /**
     * `onDelete: "cascade"` and not `restrict`.
     *
     * Blocking would be the right instinct — a register that disappears with
     * what it was auditing is not a register. But an agent is suspended and
     * never deleted (spec Q7), so the only path that ever removes one is the
     * deletion of its project, and that path already reaches these rows through
     * `project_id`. A `restrict` here would not save the history: it would turn
     * a legitimate project deletion into an error nobody can resolve.
     */
    scrumAgentId: uuid("scrum_agent_id")
      .notNull()
      .references(() => scrumAgents.id, { onDelete: "cascade" }),

    /** `text` and not the enum: the register outlives the catalogue entry. */
    skillKey: text("skill_key").notNull(),

    trigger: skillTrigger("trigger").notNull(),

    /** Both instants in UTC with time zone (R2); the UI converts at its edge. */
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }).notNull(),

    /**
     * Measured, not derived from the two instants: it is read from a monotonic
     * clock and stays truthful even if the wall clock moves under the process.
     */
    durationMs: integer("duration_ms").notNull(),

    status: skillRunStatus("status").notNull(),
    /** `null` exactly when the run succeeded — enforced by the check below. */
    failureCause: skillRunFailureCause("failure_cause"),

    /** `null` when no provider was ever contacted. The absence is the fact recorded. */
    provider: llmProvider("provider"),
    model: text("model"),

    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),

    /**
     * An estimate computed by code from a versioned price list (criterio 28),
     * shown to a reader and reconciled against nothing. `double precision`
     * rather than `numeric`: the domain declares a plain number, and a decimal
     * type here would promise an accounting accuracy this figure does not have.
     */
    estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull(),

    ...auditColumns,
  },
  (table) => [
    /**
     * The register read, exactly as criterio 29 asks for it: one organization,
     * one project, most recent first, capped. Descending in the index too, so
     * the first page is the head of the index instead of a sort over the whole
     * history.
     */
    index("skill_runs_project_started_idx").on(
      table.organizationId,
      table.projectId,
      table.startedAt.desc(),
    ),

    /**
     * The daily cap counts one agent's runs since midnight (criterio 27), and
     * it runs *before* every execution — the one query on this table that is on
     * a hot path.
     */
    index("skill_runs_agent_started_idx").on(table.scrumAgentId, table.startedAt.desc()),

    /**
     * The invariants of `validSkillRunSchema`, restated where they cannot be
     * bypassed (R9). Zod protects the code path we wrote; this protects the
     * next one, a seed script and a hand-run `UPDATE`.
     */
    check(
      "skill_runs_period_check",
      sql`${table.finishedAt} >= ${table.startedAt}`,
    ),
    check(
      "skill_runs_failure_cause_check",
      sql`(${table.status} = ${literal(skillRunStatusSchema.enum.failed)}) = (${table.failureCause} IS NOT NULL)`,
    ),
    check(
      "skill_runs_measures_check",
      sql`${table.durationMs} >= 0 AND ${table.inputTokens} >= 0 AND ${table.outputTokens} >= 0 AND ${table.estimatedCostUsd} >= 0`,
    ),
  ],
);
