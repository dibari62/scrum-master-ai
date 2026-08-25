import { randomUUID } from "node:crypto";

import {
  effectiveTokenBudget,
  projectSchema,
  stateTransitionSchema,
  type BottleneckNarrative,
  type OrganizationId,
  type ProjectId,
  type ScrumAgent,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { skillRuns } from "@/db/schema";
import {
  BOTTLENECK_BUDGET,
  buildBottleneckSnapshot,
  composeCodeNarrative,
  hasFlowToDescribe,
  narrateBottleneck,
} from "@/agents/bottleneck";
import type { NarrationOrigin } from "@/agents/sprint-health";
import { bottleneck } from "@/metrics";
import { createGateway, selectedProvider, type Gateway } from "@/lib/llm";

/**
 * Explaining where the work waits, and writing down what it cost.
 *
 * Like the health narration, the text is **not stored**: it describes the flow
 * as it is now, and the flow page beside it recomputes on every visit. A kept
 * paragraph would start disagreeing with the table above it within a day.
 */

export const SKILL_KEY = "bottleneck-detection";

export type BottleneckNarrationOutcome = {
  readonly ok: boolean;
  readonly skillRunId: string | null;
  readonly narrative: BottleneckNarrative | null;
  readonly origin: NarrationOrigin | null;
  readonly failureCause: SkillRunFailureCause | null;
  readonly message: string;
};

export type BottleneckNarrationOptions = {
  readonly gateway?: Gateway | undefined;
  readonly now?: (() => Date) | undefined;
  readonly runsToday?: number | undefined;
};

export async function runBottleneckNarration(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly agent: ScrumAgent;
  readonly options?: BottleneckNarrationOptions;
}): Promise<BottleneckNarrationOutcome> {
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
  ): Promise<BottleneckNarrationOutcome> => {
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

    return { ok: false, skillRunId: runId, narrative: null, origin: null, failureCause, message };
  };

  if (input.agent.status === "suspended") {
    return refuse(
      "agent_suspended",
      "Lo Scrum Master AI è sospeso: riattivalo per chiedere una spiegazione.",
    );
  }

  if (!input.agent.enabledSkillKeys.includes(SKILL_KEY)) {
    return {
      ok: false,
      skillRunId: null,
      narrative: null,
      origin: null,
      failureCause: null,
      message: "Il collo di bottiglia non è fra le skill abilitate su questo Scrum Master AI.",
    };
  }

  const cap = input.agent.policy.maxRunsPerDay;
  if ((options.runsToday ?? 0) >= cap) {
    return refuse(
      "quota_exceeded",
      `Raggiunto il limite di ${cap} esecuzioni al giorno per questo agente.`,
    );
  }

  const [projectRow] = await scope.reads.projectById(input.projectId);
  if (!projectRow) return refuse("invalid_output", "Progetto non trovato.");

  const project = projectSchema.parse(projectRow);

  const transitionRows = await scope.reads.transitionsByProject(input.projectId);
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));

  const measured = bottleneck(transitions, startedAt);

  if (!measured.available) {
    return refuse(
      "invalid_output",
      "Nessun elemento ha ancora attraversato il flusso: non c'è un percorso da descrivere.",
    );
  }

  const snapshot = buildBottleneckSnapshot({
    projectName: project.name,
    bottleneck: measured.value,
  });

  if (!hasFlowToDescribe(snapshot)) {
    return refuse("invalid_output", "Non ci sono fasi osservate da descrivere.");
  }

  // Senza fornitore non si chiama nessuno e non si finge: il codice sa già
  // quale fase trattiene il lavoro, e lo scrive dichiarando di averlo scritto.
  if (selectedProvider() === "fake") {
    await record({
      status: "succeeded",
      failureCause: null,
      provider: "fake",
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 0,
    });

    return {
      ok: true,
      skillRunId: runId,
      narrative: composeCodeNarrative(snapshot),
      origin: "code",
      failureCause: null,
      message: "",
    };
  }

  const outcome = await narrateBottleneck({
    gateway,
    snapshot,
    language: input.agent.language,
    maxTokens: effectiveTokenBudget(input.agent.policy, BOTTLENECK_BUDGET),
  });

  if (!outcome.ok) {
    await record({ status: "failed", failureCause: outcome.failureCause, ...outcome.usage });

    return {
      ok: false,
      skillRunId: runId,
      narrative: null,
      origin: null,
      failureCause: outcome.failureCause,
      message: outcome.message,
    };
  }

  await record({ status: "succeeded", failureCause: null, ...outcome.usage });

  return {
    ok: true,
    skillRunId: runId,
    narrative: outcome.narrative,
    origin: "model",
    failureCause: null,
    message: "",
  };
}
