/**
 * Conversion between the canonical model and database rows.
 *
 * Only entities whose row shape differs from the canonical shape belong here.
 * Everything else maps field for field and needs no translation.
 *
 * The two directions live side by side deliberately. They were previously
 * written in two different places — the write path in `scripts/seed.ts`, the
 * read path in `src/app/progetti/data.ts` — and they silently disagreed: the
 * writer dropped `estimate` entirely, so every estimate in the database was
 * null while the reader dutifully reconstructed nothing. Nothing failed, no
 * test broke, and the dashboard reported "nessuna stima" for four sprints.
 *
 * TypeScript cannot catch that on its own. `db.insert(t).values(rows)` accepts
 * a variable holding objects with extra properties (excess property checks only
 * apply to object literals), and every column `estimate` should have filled is
 * nullable, therefore optional. Only an explicit mapper written as an object
 * literal makes the compiler check the correspondence.
 */

import type {
  AgentPolicy,
  Estimate,
  EstimateChange,
  ProjectContext,
  ScrumAgent,
  SkillRun,
  WorkItem,
} from "@/domain";
import {
  agentPolicySchema,
  ceremonyScheduleSchema,
  definitionOfDoneSchema,
  estimateChangeSchema,
  estimateSchema,
  stakeholdersSchema,
} from "@/domain";

import type {
  estimateChanges,
  projectContexts,
  scrumAgents,
  skillRuns,
  workItems,
} from "./schema";

/**
 * Every column, none optional.
 *
 * `$inferInsert` makes nullable columns optional, so a mapper that simply
 * forgot one would still typecheck and write a null. Requiring all of them
 * turns "fill every column" from a convention into a compile error.
 */
type WorkItemRow = Required<typeof workItems.$inferInsert>;

/** The subset of a selected row this module needs to rebuild an estimate. */
export interface WorkItemEstimateColumns {
  readonly estimateValue: number | null;
  readonly estimateUnit: string | null;
}

/**
 * Canonical item to insertable row.
 *
 * Written as an object literal so that a renamed or forgotten column is a
 * compile error rather than a null in production.
 */
export function toWorkItemRow(item: WorkItem): WorkItemRow {
  return {
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.projectId,
    sourceSystem: item.sourceSystem,
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title,
    description: item.description,
    state: item.state,
    estimateValue: item.estimate?.value ?? null,
    estimateUnit: item.estimate?.unit ?? null,
    sprintId: item.sprintId,
    assigneeId: item.assigneeId,
    parentId: item.parentId,
    sourceCreatedAt: item.sourceCreatedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Rebuilds the canonical `estimate` from its two columns.
 *
 * Half an estimate is not an estimate: a value without a unit cannot be summed
 * with anything, so it is treated as absent rather than guessed at. The unit is
 * parsed, not cast — the column is plain `text`, and a value that is neither
 * `points` nor `hours` means the database disagrees with the domain, which is a
 * defect worth surfacing rather than swallowing.
 */
export function workItemEstimate(row: WorkItemEstimateColumns): WorkItem["estimate"] {
  if (row.estimateValue === null || row.estimateUnit === null) return null;

  return estimateSchema.parse({ value: row.estimateValue, unit: row.estimateUnit });
}

type EstimateChangeRow = Required<typeof estimateChanges.$inferInsert>;

/**
 * Canonical estimate change to insertable row.
 *
 * Written as an object literal for the reason stated at the top of this file:
 * `$inferInsert` makes every nullable column optional, and all four estimate
 * columns here are nullable. A mapper that forgot one would compile and write
 * silent nulls — which is exactly how `estimate` stayed empty for four sprints.
 */
export function toEstimateChangeRow(change: EstimateChange): EstimateChangeRow {
  return {
    id: change.id,
    organizationId: change.organizationId,
    projectId: change.projectId,
    sourceSystem: change.sourceSystem,
    sourceId: change.sourceId,
    workItemId: change.workItemId,
    fromValue: change.fromEstimate?.value ?? null,
    fromUnit: change.fromEstimate?.unit ?? null,
    toValue: change.toEstimate?.value ?? null,
    toUnit: change.toEstimate?.unit ?? null,
    occurredAt: change.occurredAt,
    actorId: change.actorId,
    createdAt: change.createdAt,
    updatedAt: change.updatedAt,
  };
}

/** The subset of a selected row needed to rebuild one end of a change. */
export interface EstimateEndColumns {
  readonly value: number | null;
  readonly unit: string | null;
}

/**
 * Rebuilds one end of an estimate change from its two columns.
 *
 * Same rule as `workItemEstimate`: half an estimate is not an estimate. Kept as
 * its own function rather than reusing that one because the column names differ
 * at each end, and renaming a parameter to make one function fit two shapes is
 * how a mapper ends up reading `from` while claiming to read `to`.
 */
export function estimateEnd(row: EstimateEndColumns): Estimate | null {
  if (row.value === null || row.unit === null) return null;

  return estimateSchema.parse({ value: row.value, unit: row.unit });
}

/** A selected `estimate_changes` row, rebuilt into the canonical shape. */
export function toEstimateChange(row: EstimateChangeRow): EstimateChange {
  return estimateChangeSchema.parse({
    ...row,
    fromEstimate: estimateEnd({ value: row.fromValue, unit: row.fromUnit }),
    toEstimate: estimateEnd({ value: row.toValue, unit: row.toUnit }),
  });
}

/* -------------------------------------------------------------------------- */
/* Scrum Master AI (T3)                                                       */
/* -------------------------------------------------------------------------- */

type ScrumAgentRow = Required<typeof scrumAgents.$inferInsert>;
type ProjectContextRow = Required<typeof projectContexts.$inferInsert>;
type SkillRunRow = Required<typeof skillRuns.$inferInsert>;

/**
 * Canonical agent to insertable row.
 *
 * The one shape that genuinely differs: `policy` is a canonical object living
 * on two columns, which is precisely the situation that produced four sprints
 * of silent nulls for `estimate`. `maxTokensPerRun` is nullable — therefore
 * optional in `$inferInsert` — so a mapper that simply forgot the policy would
 * still compile and would quietly write "no ceiling declared" on every agent.
 * `Required<>` plus an object literal makes that a compile error.
 */
export function toScrumAgentRow(agent: ScrumAgent): ScrumAgentRow {
  return {
    id: agent.id,
    organizationId: agent.organizationId,
    projectId: agent.projectId,
    name: agent.name,
    persona: agent.persona,
    tone: agent.tone,
    language: agent.language,
    autonomyLevel: agent.autonomyLevel,
    status: agent.status,
    enabledSkillKeys: agent.enabledSkillKeys,
    maxTokensPerRun: agent.policy.maxTokensPerRun,
    maxRunsPerDay: agent.policy.maxRunsPerDay,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

/** The subset of a selected agent row needed to rebuild a policy. */
export interface ScrumAgentPolicyColumns {
  readonly maxTokensPerRun: number | null;
  readonly maxRunsPerDay: number;
}

/**
 * Rebuilds the canonical `policy` from its two columns.
 *
 * `null` in `max_tokens_per_run` is meaning, not absence: "do not reduce what
 * the skill declared". So, unlike an estimate, half a policy is not treated as
 * a missing policy — only `maxRunsPerDay` is mandatory, and the database
 * already refuses a row without it.
 *
 * Parsed rather than cast: the columns are plain integers and a row written by
 * something other than this module — a seed, a manual fix — could hold a cap of
 * zero, which the domain forbids. A defect worth surfacing, not swallowing.
 */
export function scrumAgentPolicy(row: ScrumAgentPolicyColumns): AgentPolicy {
  return agentPolicySchema.parse({
    maxTokensPerRun: row.maxTokensPerRun,
    maxRunsPerDay: row.maxRunsPerDay,
  });
}

/**
 * Canonical context to insertable row.
 *
 * Field for field except in one respect: three columns are `jsonb`, and a
 * `jsonb` column accepts anything JSON can express. The mapper is the narrow
 * point where a canonical value goes in, so what the database receives has been
 * through `projectContextSchema` first.
 */
export function toProjectContextRow(context: ProjectContext): ProjectContextRow {
  return {
    id: context.id,
    organizationId: context.organizationId,
    projectId: context.projectId,
    sprintLengthDays: context.sprintLengthDays,
    ceremonies: context.ceremonies,
    definitionOfDone: context.definitionOfDone,
    workingAgreement: context.workingAgreement,
    stakeholders: context.stakeholders,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
}

/** The `jsonb` columns of a selected context row, as the driver returns them. */
export interface ProjectContextJsonColumns {
  readonly ceremonies: unknown;
  readonly definitionOfDone: unknown;
  readonly stakeholders: unknown;
}

/**
 * Rebuilds the three nested structures of a context.
 *
 * `$type<...>()` on a `jsonb` column is a *claim*, not a check: drizzle hands
 * back whatever the row contains, typed as whatever we declared. That is the
 * price of choosing `jsonb` over child tables — the shape is enforced on the
 * way in, so it has to be verified on the way out, once, here. A ceremony
 * schedule missing an event, or a stakeholder with an audience this release no
 * longer knows, is a disagreement between database and domain and must be
 * visible rather than propagated into a card.
 */
export function projectContextStructures(
  row: ProjectContextJsonColumns,
): Pick<ProjectContext, "ceremonies" | "definitionOfDone" | "stakeholders"> {
  return {
    ceremonies: ceremonyScheduleSchema.parse(row.ceremonies),
    definitionOfDone: definitionOfDoneSchema.parse(row.definitionOfDone),
    stakeholders: stakeholdersSchema.parse(row.stakeholders),
  };
}

/**
 * Canonical run to insertable row.
 *
 * The shape matches column for column, so by the rule at the top of this file
 * it would not need a mapper. It has one anyway, for the reason that mapper
 * exists at all: four of its columns are nullable — `failure_cause`,
 * `provider`, `model` — and therefore optional in `$inferInsert`. A writer that
 * omitted the provider would compile, write a null, and produce a register that
 * says "no provider was contacted" about runs that were served by one. That is
 * the `estimate` bug with a different column name.
 */
export function toSkillRunRow(run: SkillRun): SkillRunRow {
  return {
    id: run.id,
    organizationId: run.organizationId,
    projectId: run.projectId,
    scrumAgentId: run.scrumAgentId,
    skillKey: run.skillKey,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    status: run.status,
    failureCause: run.failureCause,
    provider: run.provider,
    model: run.model,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    estimatedCostUsd: run.estimatedCostUsd,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
