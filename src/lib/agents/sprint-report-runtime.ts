import { randomUUID } from "node:crypto";

import {
  effectiveTokenBudget,
  projectSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  workItemSchema,
  type MetricSnapshot,
  type OrganizationId,
  type ProjectId,
  type ScrumAgent,
  type SkillRunFailureCause,
  type SprintId,
  type WorkItemId,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import { skillRuns, sprintReports } from "@/db/schema";
import {
  SPRINT_REPORT_BUDGET,
  buildSnapshot,
  generateSprintReport,
  selectEvidence,
} from "@/agents/sprint-report";
import {
  carryOver,
  scopeChange,
  summariseFlow,
  throughput,
  velocity,
  type Milliseconds,
} from "@/metrics";
import { createGateway, type Gateway } from "@/lib/llm";

/**
 * Producing a sprint report and writing down what it cost.
 *
 * This file is the only place where the pieces meet a database. Everything it
 * orchestrates — metrics, evidence, the call, the checks — is pure and already
 * tested elsewhere; what is added here is reading the project, recording the run
 * and storing the result together with the numbers it was written from.
 *
 * A refusal is recorded as carefully as a success, and usually says more.
 */

/** The key this runtime executes, declared once so nothing retypes it. */
export const SKILL_KEY = "sprint-report";

export type SprintReportOutcome = {
  readonly ok: boolean;
  /**
   * `null` when the attempt never became an execution.
   *
   * A skill that is not enabled is refused before anything runs, exactly as an
   * unavailable one is: it consumed nothing, so there is nothing to write in a
   * register whose purpose is recording what was spent.
   */
  readonly skillRunId: string | null;
  readonly reportId: string | null;
  readonly failureCause: SkillRunFailureCause | null;
  readonly message: string;
};

export type SprintReportOptions = {  readonly gateway?: Gateway | undefined;
  readonly now?: (() => Date) | undefined;
  readonly runsToday?: number | undefined;
  /** Passed through to the deterministic provider so the skill is demonstrable. */
  readonly stubResponse?: string | undefined;
};

/**
 * The 85th percentile of the project, used as "long".
 *
 * A threshold taken from the project's own distribution rather than a fixed
 * number of days: what counts as a long wait on a team that ships in hours is
 * not what counts on one that ships in weeks, and a constant would flag every
 * item on one and none on the other.
 */
function thresholdOf(result: { available: boolean } & Record<string, unknown>): number | null {
  return result.available ? (result["value"] as Milliseconds) : null;
}

export async function runSprintReport(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly sprintId: SprintId;
  readonly agent: ScrumAgent;
  readonly options?: SprintReportOptions;
}): Promise<SprintReportOutcome> {
  const options = input.options ?? {};
  const now = options.now ?? (() => new Date());
  const gateway = options.gateway ?? createGateway();

  const startedAt = now();
  const runId = randomUUID();
  const scope = forOrganization(getDatabase(), input.organizationId);

  const record = async (fields: {
    readonly status: "succeeded" | "failed";
    readonly failureCause: SkillRunFailureCause | null;
    readonly provider: "gemini" | "groq" | "fake" | null;
    readonly model: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostUsd: number;
    readonly durationMs: number;
  }): Promise<void> => {
    const finishedAt = new Date(startedAt.getTime() + fields.durationMs);

    await getDatabase()
      .insert(skillRuns)
      .values({
        id: runId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        scrumAgentId: input.agent.id,
        skillKey: SKILL_KEY,
        trigger: "on_demand",
        startedAt,
        finishedAt,
        ...fields,
        createdAt: finishedAt,
        updatedAt: finishedAt,
      });
  };

  const refuse = async (
    failureCause: SkillRunFailureCause,
    message: string,
  ): Promise<SprintReportOutcome> => {
    await record({
      status: "failed",
      failureCause,
      provider: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 0,
    });

    return { ok: false, skillRunId: runId, reportId: null, failureCause, message };
  };

  if (input.agent.status === "suspended") {
    return refuse(
      "agent_suspended",
      "Lo Scrum Master AI è sospeso: riattivalo per generare un resoconto.",
    );
  }

  /*
   * The configuration is obeyed, not decorated.
   *
   * The card announces which skills are enabled; running one that is not would
   * make that announcement a decoration. Refused before anything happens, so no
   * row is written and no token is spent.
   */
  if (!input.agent.enabledSkillKeys.includes(SKILL_KEY)) {
    return {
      ok: false,
      skillRunId: null,
      reportId: null,
      failureCause: null,
      message: "Il resoconto di sprint non è fra le skill abilitate su questo Scrum Master AI.",
    };
  }

  const cap = input.agent.policy.maxRunsPerDay;
  if ((options.runsToday ?? 0) >= cap) {
    return refuse(
      "quota_exceeded",
      `Raggiunto il limite di ${cap} esecuzioni al giorno per questo agente.`,
    );
  }

  const [sprintRow] = await scope.reads.sprintById(input.sprintId);
  if (!sprintRow || sprintRow.projectId !== input.projectId) {
    return refuse("invalid_output", "Lo sprint richiesto non appartiene a questo progetto.");
  }

  const sprint = sprintSchema.parse(sprintRow);

  /*
   * Only closed sprints.
   *
   * A end-of-sprint report on a sprint still running would state, in the past
   * tense, figures that are going to change. It is not an approximation: it is a
   * document that says something false about a period that has not ended.
   */
  if (sprint.completedAt === null) {
    return refuse(
      "invalid_output",
      "Il resoconto si genera su uno sprint concluso: quello scelto è ancora aperto.",
    );
  }

  const [projectRow] = await scope.reads.projectById(input.projectId);
  if (!projectRow) return refuse("invalid_output", "Progetto non trovato.");

  const project = projectSchema.parse(projectRow);

  const [itemRows, transitionRows, scopeRows] = await Promise.all([
    scope.reads.workItemsByProject(input.projectId),
    scope.reads.transitionsByProject(input.projectId),
    scope.reads.scopeEventsByProject(input.projectId),
  ]);

  const items = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));
  const scopeEvents = scopeRows.map((row) => sprintScopeEventSchema.parse(row));

  const asOf = sprint.completedAt ?? sprint.endsAt;
  const flow = summariseFlow(items, transitions, asOf);
  const velocityResult = velocity(sprint, items, transitions, scopeEvents);
  const scopeResult = scopeChange(sprint, items, scopeEvents);
  const carryResult = carryOver(sprint, items, transitions, scopeEvents);
  const throughputResult = throughput(transitions, sprint.startsAt, asOf);

  const carried = new Set<WorkItemId>(carryResult.available ? carryResult.value.items : []);
  const added = new Set<WorkItemId>(
    scopeResult.available
      ? scopeEvents
          .filter(
            (event) =>
              event.sprintId === sprint.id &&
              event.kind === "added" &&
              event.occurredAt.getTime() > sprint.startsAt.getTime(),
          )
          .map((event) => event.workItemId)
      : [],
  );

  const evidence = selectEvidence({
    items,
    transitions,
    carriedOver: carried,
    addedMidSprint: added,
    reviewWaitThresholdMs: thresholdOf(flow.reviewWait.p85),
    cycleTimeThresholdMs: thresholdOf(flow.cycleTime.p85),
    asOf,
  });

  const snapshot: MetricSnapshot = buildSnapshot({
    sprintId: sprint.id,
    sprintName: sprint.name,
    takenAt: startedAt,
    flow,
    velocity: velocityResult,
    scopeChange: scopeResult,
    carryOver: carryResult,
    throughput: throughputResult,
    evidence: evidence.items,
    evidenceTruncated: evidence.truncated,
  });

  const outcome = await generateSprintReport({
    gateway,
    snapshot,
    projectName: project.name,
    language: input.agent.language,
    maxTokens: effectiveTokenBudget(input.agent.policy, SPRINT_REPORT_BUDGET),
    stubResponse: options.stubResponse,
  });

  if (!outcome.ok) {
    await record({
      status: "failed",
      failureCause: outcome.failureCause,
      ...outcome.usage,
    });

    return {
      ok: false,
      skillRunId: runId,
      reportId: null,
      failureCause: outcome.failureCause,
      message: outcome.message,
    };
  }

  await record({ status: "succeeded", failureCause: null, ...outcome.usage });

  const reportId = randomUUID();
  const generatedAt = new Date(startedAt.getTime() + outcome.usage.durationMs);

  await getDatabase()
    .insert(sprintReports)
    .values({
      id: reportId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      sprintId: sprint.id,
      scrumAgentId: input.agent.id,
      skillRunId: runId,
      origin: outcome.report.origin,
      content: outcome.report.content,
      snapshot: outcome.report.snapshot,
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });

  return {
    ok: true,
    skillRunId: runId,
    reportId,
    failureCause: null,
    message: outcome.report.content.summary,
  };
}
