import { randomUUID } from "node:crypto";

import {
  effectiveTokenBudget,
  isSkillAvailable,
  skillKeySchema,
  type OrganizationId,
  type ProjectId,
  type ScrumAgent,
  type SkillKey,
  type LlmProvider,
  type SkillRunFailureCause,
} from "@/domain";
import { getDatabase } from "@/db";
import { skillRuns } from "@/db/schema";
import type { Gateway } from "@/lib/llm";

import { gatewayForProject } from "./project-gateway";

/**
 * Running a skill and writing down what it cost.
 *
 * The register is the only place where the price of this product is visible, so
 * a run that failed is recorded as carefully as one that worked — usually more
 * interestingly. Criterio 25 is explicit: **exactly one** row per execution
 * that reaches the runtime, whatever the outcome.
 *
 * The one skill T3 can actually run is `configuration-check`. It exists to
 * prove that gateway and register work end to end, and deliberately touches no
 * project data: no work items, no metrics, no ingested text (criterio 24). The
 * skills that narrate numbers are T4.
 */

/** What T3 declares but cannot yet run. */
export const RUNNABLE_SKILL: SkillKey = "configuration-check";

/**
 * The budget of the only skill in T3.
 *
 * Small on purpose: the call carries a handful of configuration fields and
 * nothing else, so a generous ceiling would only hide a mistake that made it
 * carry more.
 */
export const CONFIGURATION_CHECK_BUDGET = 2000;

const SYSTEM_PROMPT = [
  "Sei lo Scrum Master AI di un progetto software.",
  "Questa è una verifica di configurazione: conferma in una frase di aver ricevuto",
  "le impostazioni, nella lingua indicata.",
  "Non inventare numeri. Non citare persone. Non dedurre stati d'animo.",
].join(" ");

export type RunOutcome = {
  readonly ok: boolean;
  readonly skillRunId: string;
  readonly failureCause: SkillRunFailureCause | null;
  readonly message: string;
};

export type RunOptions = {
  readonly gateway?: Gateway | undefined;
  readonly now?: (() => Date) | undefined;
  /** How many runs the agent has already had today, counted by the caller. */
  readonly runsToday?: number | undefined;
};

/**
 * Executes the configuration check and records the run.
 *
 * Refusals happen before the gateway and are still written down. A run stopped
 * because the agent is suspended or the daily cap is spent is a decision of the
 * runtime, and a decision nobody can see is a decision nobody can question
 * (criteri 26, 27, 30).
 */
export async function runConfigurationCheck(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly agent: ScrumAgent;
  readonly options?: RunOptions;
}): Promise<RunOutcome> {
  const options = input.options ?? {};
  const now = options.now ?? (() => new Date());
  const gateway =
    options.gateway ??
    // La chiave e del progetto, non dell'applicazione (ADR-0010).
    (await gatewayForProject(input.organizationId, input.projectId));

  const startedAt = now();
  const id = randomUUID();

  const record = async (fields: {
    readonly status: "succeeded" | "failed";
    readonly failureCause: SkillRunFailureCause | null;
    readonly provider: LlmProvider | null;
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
        id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        scrumAgentId: input.agent.id,
        skillKey: RUNNABLE_SKILL,
        // The only trigger wired in T3: `scheduled` and `event` are declared in
        // the catalogue but have no mechanism behind them until T5.
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
  ): Promise<RunOutcome> => {
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

    return { ok: false, skillRunId: id, failureCause, message };
  };

  if (input.agent.status === "suspended") {
    return refuse(
      "agent_suspended",
      "Lo Scrum Master AI è sospeso: riattivalo per eseguire una verifica.",
    );
  }

  const cap = input.agent.policy.maxRunsPerDay;
  if ((options.runsToday ?? 0) >= cap) {
    return refuse(
      "quota_exceeded",
      `Raggiunto il limite di ${cap} esecuzioni al giorno per questo agente.`,
    );
  }

  const outcome = await gateway.complete({
    system: SYSTEM_PROMPT,
    prompt: [
      "Impostazioni ricevute:",
      `- persona: ${input.agent.persona}`,
      `- tono: ${input.agent.tone}`,
      `- lingua: ${input.agent.language}`,
      `- livello di autonomia: ${input.agent.autonomyLevel}`,
    ].join("\n"),
    maxTokens: effectiveTokenBudget(input.agent.policy, CONFIGURATION_CHECK_BUDGET),
    language: input.agent.language,
  });

  if (!outcome.ok) {
    await record({
      status: "failed",
      failureCause: outcome.failureCause,
      provider: outcome.provider,
      model: outcome.model,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      estimatedCostUsd: outcome.estimatedCostUsd,
      durationMs: outcome.durationMs,
    });

    return {
      ok: false,
      skillRunId: id,
      failureCause: outcome.failureCause,
      message: outcome.message,
    };
  }

  await record({
    status: "succeeded",
    failureCause: null,
    provider: outcome.provider,
    model: outcome.model,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    estimatedCostUsd: outcome.estimatedCostUsd,
    durationMs: outcome.durationMs,
  });

  return { ok: true, skillRunId: id, failureCause: null, message: outcome.text };
}

/**
 * Whether a skill key may be executed at all.
 *
 * Checked **before** the gateway so a declared-but-unavailable skill produces
 * no `SkillRun` and consumes no tokens (criterio 26): it never became an
 * execution, so there is nothing to record.
 */
export function canRun(key: string): boolean {
  const parsed = skillKeySchema.safeParse(key);
  return parsed.success && isSkillAvailable(parsed.data);
}
