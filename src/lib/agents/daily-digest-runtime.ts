import { randomUUID } from "node:crypto";

import {
  effectiveTokenBudget,
  projectSchema,
  stateTransitionSchema,
  workItemSchema,
  type DigestNarrative,
  type OrganizationId,
  type ProjectId,
  type ScrumAgent,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import { skillRuns } from "@/db/schema";
import {
  DAILY_DIGEST_BUDGET,
  buildDigestSnapshot,
  composeCodeNarrative,
  narrateDigest,
} from "@/agents/daily-digest";
import type { NarrationOrigin } from "@/agents/sprint-health";
import { dailyActivity, summariseFlow, type Milliseconds } from "@/metrics";
import { formatDate } from "@/lib/format";
import { selectedProvider, type Gateway } from "@/lib/llm";

import { gatewayForProject } from "./project-gateway";

/**
 * Writing up a day of the project.
 *
 * **Where «yesterday» is decided.** Here, at the edge, and nowhere else: the
 * metrics engine takes a window as a parameter because the boundary of a day
 * depends on the reader's timezone (ADR-0002). This runtime turns a calendar
 * date into that window, and everything below it stays reproducible.
 */

export const SKILL_KEY = "daily-digest";

export type DigestOutcomeSummary = {
  readonly ok: boolean;
  readonly skillRunId: string | null;
  readonly narrative: DigestNarrative | null;
  readonly origin: NarrationOrigin | null;
  readonly failureCause: SkillRunFailureCause | null;
  readonly message: string;
};

export type DigestOptions = {
  readonly gateway?: Gateway | undefined;
  readonly now?: (() => Date) | undefined;
  readonly runsToday?: number | undefined;
};

const DAY_MS = 86_400_000;

/**
 * The window the digest describes: the calendar day before the request.
 *
 * Computed in UTC, which is what the whole application stores (§7). It is an
 * approximation for a team in another timezone, and it is stated rather than
 * hidden: the day label travels with the text, so a reader can see which
 * twenty-four hours were counted.
 */
export function previousDay(now: Date): { readonly from: Date; readonly to: Date } {
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);

  const from = new Date(midnight.getTime() - DAY_MS);
  const to = new Date(midnight.getTime() - 1);

  return { from, to };
}

export async function runDailyDigest(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly agent: ScrumAgent;
  readonly options?: DigestOptions;
}): Promise<DigestOutcomeSummary> {
  const options = input.options ?? {};
  const now = options.now ?? (() => new Date());
  const gateway =
    options.gateway ??
    // La chiave e del progetto, non dell'applicazione (ADR-0010).
    (await gatewayForProject(input.organizationId, input.projectId));

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
  ): Promise<DigestOutcomeSummary> => {
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
      "Lo Scrum Master AI è sospeso: riattivalo per chiedere il digest.",
    );
  }

  if (!input.agent.enabledSkillKeys.includes(SKILL_KEY)) {
    return {
      ok: false,
      skillRunId: null,
      narrative: null,
      origin: null,
      failureCause: null,
      message: "Il digest giornaliero non è fra le skill abilitate su questo Scrum Master AI.",
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

  const [itemRows, transitionRows] = await Promise.all([
    scope.reads.workItemsByProject(input.projectId),
    scope.reads.transitionsByProject(input.projectId),
  ]);

  const items = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));

  const window = previousDay(startedAt);

  /*
   * Cosa conta come «fermo» lo decide il progetto, non una costante.
   *
   * L'85° percentile del cycle time è quanto impiega di solito questo progetto:
   * un elemento oltre quella soglia è fermo secondo le abitudini della squadra,
   * non secondo un numero scelto da noi. Su una squadra che chiude in ore e una
   * che chiude in settimane, una costante segnalerebbe tutto sulla prima e
   * niente sulla seconda.
   */
  const flow = summariseFlow(items, transitions, startedAt);
  const stalledAfterMs: Milliseconds | null = flow.cycleTime.p85.available
    ? flow.cycleTime.p85.value
    : null;

  const activity = dailyActivity({
    transitions,
    from: window.from,
    to: window.to,
    stalledAfterMs,
  });

  if (!activity.available) {
    return refuse(
      "invalid_output",
      "Questo progetto non ha ancora una storia degli stati: non c'è una giornata da riassumere.",
    );
  }

  const snapshot = buildDigestSnapshot({
    projectName: project.name,
    dayLabel: formatDate(window.from),
    activity: activity.value,
    items,
  });

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

  const outcome = await narrateDigest({
    gateway,
    snapshot,
    language: input.agent.language,
    maxTokens: effectiveTokenBudget(input.agent.policy, DAILY_DIGEST_BUDGET),
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
