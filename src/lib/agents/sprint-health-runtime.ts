import { randomUUID } from "node:crypto";

import {
  boardColumnSchema,
  effectiveTokenBudget,
  healthVerdictSchema,
  projectSchema,
  sprintScopeEventSchema,
  sprintSchema,
  stateTransitionSchema,
  workItemSchema,
  type HealthNarrative,
  type OrganizationId,
  type ProjectId,
  type ScrumAgent,
  type LlmProvider,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import { skillRuns } from "@/db/schema";
import {
  SPRINT_HEALTH_BUDGET,
  buildHealthSnapshot,
  composeCodeNarrative,
  isNarratable,
  narrateSprintHealth,
  type HistoryPoint,
  type NarrationOrigin,
} from "@/agents/sprint-health";
import { sprintHealth } from "@/metrics";
import { formatDate } from "@/lib/format";
import { VERDICT_WORDS } from "@/lib/health-words";
import { selectedProvider, type Gateway } from "@/lib/llm";

import { gatewayForProject } from "./project-gateway";

/**
 * Explaining the health of the running sprint, and writing down what it cost.
 *
 * The verdict is recomputed here rather than read from the last stored check,
 * and the difference matters: the stored checks are a *history*, taken once a
 * day, while the reader is asking about now. Narrating yesterday's verdict under
 * today's banner would put two different judgements on one screen.
 *
 * The narration itself is not stored (spec: «la persistenza del testo» is out of
 * scope). It describes a state that changes; kept, it would become a confident
 * description of a situation that is no longer true.
 */

export const SKILL_KEY = "sprint-health";

export type HealthNarrationOutcome = {
  readonly ok: boolean;
  /** `null` when the attempt never became an execution. */
  readonly skillRunId: string | null;
  readonly narrative: HealthNarrative | null;
  /** Who wrote the text, so the interface never claims a model that was absent. */
  readonly origin: NarrationOrigin | null;
  readonly failureCause: SkillRunFailureCause | null;
  readonly message: string;
};

export type HealthNarrationOptions = {
  readonly gateway?: Gateway | undefined;
  readonly now?: (() => Date) | undefined;
  readonly runsToday?: number | undefined;
  readonly stubResponse?: string | undefined;
};

export async function runSprintHealthNarration(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly agent: ScrumAgent;
  readonly options?: HealthNarrationOptions;
}): Promise<HealthNarrationOutcome> {
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
  ): Promise<HealthNarrationOutcome> => {
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
      message: "La salute dello sprint non è fra le skill abilitate su questo Scrum Master AI.",
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

  const [sprintRows, itemRows, transitionRows, scopeRows, columnRows] = await Promise.all([
    scope.reads.sprintsByProject(input.projectId),
    scope.reads.workItemsByProject(input.projectId),
    scope.reads.transitionsByProject(input.projectId),
    scope.reads.scopeEventsByProject(input.projectId),
    scope.reads.boardColumnsByProject(input.projectId),
  ]);

  const sprints = sprintRows.map((row) => sprintSchema.parse(row));

  /*
   * «In corso» means open and containing this instant, the same definition the
   * dashboard uses. The last sprint of a project abandoned months ago is over,
   * and explaining its health would answer a question nobody asked.
   */
  const running = sprints.find(
    (sprint) =>
      sprint.completedAt === null &&
      sprint.startsAt.getTime() <= startedAt.getTime() &&
      sprint.endsAt.getTime() >= startedAt.getTime(),
  );

  if (!running) {
    return refuse(
      "invalid_output",
      "Non c'è alcuno sprint in corso: la salute giudica ciò che è ancora aperto.",
    );
  }

  const items = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );

  const health = sprintHealth({
    sprint: running,
    items,
    transitions: transitionRows.map((row) => stateTransitionSchema.parse(row)),
    scopeEvents: scopeRows.map((row) => sprintScopeEventSchema.parse(row)),
    closedSprints: sprints.filter((sprint) => sprint.completedAt !== null),
    columns: columnRows.map((row) => boardColumnSchema.parse(row)),
    asOf: startedAt,
  });

  if (!health.available) {
    return refuse(
      "invalid_output",
      "Le date dello sprint non permettono di dire quanto ne sia trascorso, " +
        "quindi non c'è un giudizio da spiegare.",
    );
  }

  const historyRows = await scope.reads.healthChecksBySprint(running.id);
  const history: readonly HistoryPoint[] = historyRows.map((row) => ({
    date: formatDate(row.takenAt),
    verdictLabel: VERDICT_WORDS[healthVerdictSchema.parse(row.verdict)].label,
  }));

  const snapshot = buildHealthSnapshot({
    sprintName: running.name,
    health: health.value,
    history,
  });

  /*
   * Senza un fornitore vero non si chiama nessuno, e non si finge.
   *
   * Il provider dimostrativo restituisce una frase preparata: passarla per una
   * spiegazione significa far premere un pulsante per ricevere la notizia che il
   * pulsante non funziona. Il codice invece una spiegazione ce l'ha — quali
   * segnali sono oltre soglia e come si è mosso il verdetto sono fatti che
   * conosce — e la scrive dichiarando di averla scritta lui.
   */
  if (selectedProvider() === "fake") {
    if (!isNarratable(snapshot)) {
      return refuse(
        "invalid_output",
        "Il giudizio è «non valutabile»: non ci sono segnali misurati da spiegare.",
      );
    }

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

  const outcome = await narrateSprintHealth({
    gateway,
    snapshot,
    projectName: project.name,
    language: input.agent.language,
    maxTokens: effectiveTokenBudget(input.agent.policy, SPRINT_HEALTH_BUDGET),
    stubResponse: options.stubResponse,
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
    origin: outcome.origin,
    failureCause: null,
    message: "",
  };
}
