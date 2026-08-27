import { randomUUID } from "node:crypto";

import {
  effectiveTokenBudget,
  workItemSchema,
  type OrganizationId,
  type ProjectAnswer,
  type ProjectId,
  type ScrumAgent,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import { skillRuns } from "@/db/schema";
import {
  PROJECT_QA_BUDGET,
  answerProjectQuestion,
  composeNoSourceAnswer,
  selectSources,
  type ScoredSource,
} from "@/agents/project-qa";
import { selectedProvider, type Gateway } from "@/lib/llm";

import { gatewayForProject } from "./project-gateway";

/**
 * Answering a question about a project.
 *
 * The sources are chosen here by code before anything is asked (§9), and they
 * travel back out with the answer: the reader gets links to the very items the
 * answer was built from, which is the only way an answer with no figures beside
 * it can be checked.
 */

export const SKILL_KEY = "project-qa";

/** A source as the interface shows it: a title somebody can open. */
export type CitedSource = {
  readonly workItemId: string;
  readonly title: string;
};

export type ProjectAnswerOutcome = {
  readonly ok: boolean;
  readonly skillRunId: string | null;
  readonly answer: ProjectAnswer | null;
  /** The cited sources, in the order the answer referenced them. */
  readonly sources: readonly CitedSource[];
  readonly failureCause: SkillRunFailureCause | null;
  readonly message: string;
};

export type ProjectQaOptions = {
  readonly gateway?: Gateway | undefined;
  readonly now?: (() => Date) | undefined;
  readonly runsToday?: number | undefined;
};

/** The longest question worth accepting: past this it is a document, not a question. */
const MAX_QUESTION_LENGTH = 500;

function citedFrom(
  answer: ProjectAnswer,
  sources: readonly ScoredSource[],
): readonly CitedSource[] {
  return answer.citations
    .map((index) => sources[index])
    .filter((source) => source !== undefined)
    .map((source) => ({ workItemId: source.workItemId, title: source.title }));
}

export async function runProjectQuestion(input: {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly agent: ScrumAgent;
  readonly question: string;
  readonly options?: ProjectQaOptions;
}): Promise<ProjectAnswerOutcome> {
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
  ): Promise<ProjectAnswerOutcome> => {
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

    return {
      ok: false,
      skillRunId: runId,
      answer: null,
      sources: [],
      failureCause,
      message,
    };
  };

  const question = input.question.trim();

  if (question.length === 0) {
    return {
      ok: false,
      skillRunId: null,
      answer: null,
      sources: [],
      failureCause: null,
      message: "Scrivi una domanda: senza, non c'è nulla da cercare.",
    };
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      skillRunId: null,
      answer: null,
      sources: [],
      failureCause: null,
      message: `La domanda supera i ${MAX_QUESTION_LENGTH} caratteri: accorciala.`,
    };
  }

  if (input.agent.status === "suspended") {
    return refuse(
      "agent_suspended",
      "Lo Scrum Master AI è sospeso: riattivalo per fare una domanda.",
    );
  }

  if (!input.agent.enabledSkillKeys.includes(SKILL_KEY)) {
    return {
      ok: false,
      skillRunId: null,
      answer: null,
      sources: [],
      failureCause: null,
      message: "Le domande sul progetto non sono fra le skill abilitate su questo Scrum Master AI.",
    };
  }

  const cap = input.agent.policy.maxRunsPerDay;
  if ((options.runsToday ?? 0) >= cap) {
    return refuse(
      "quota_exceeded",
      `Raggiunto il limite di ${cap} esecuzioni al giorno per questo agente.`,
    );
  }

  const itemRows = await scope.reads.workItemsByProject(input.projectId);
  const items = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );

  const sources = selectSources(question, items);

  /*
   * Nessuna fonte: risponde il codice, e non si spende nulla.
   *
   * Un modello a cui non si danno fonti produce comunque una risposta scorrevole
   * costruita sul niente — l'esito peggiore possibile per questa capacità.
   */
  if (sources.length === 0) {
    await record({
      status: "succeeded",
      failureCause: null,
      provider: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 0,
    });

    return {
      ok: true,
      skillRunId: runId,
      answer: composeNoSourceAnswer(),
      sources: [],
      failureCause: null,
      message: "",
    };
  }

  /*
   * Senza fornitore la capacità non finge di rispondere.
   *
   * Qui, a differenza delle narrazioni, il codice **non** può sostituirsi al
   * modello: riassumere delle descrizioni in una risposta è precisamente il
   * lavoro linguistico che non sa fare. Restituisce le fonti trovate, che è un
   * risultato onesto e comunque utile, e dice perché si ferma lì.
   */
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
      answer: {
        answer:
          `Su questo ambiente non è configurato alcun fornitore di modelli linguistici, ` +
          `quindi non posso comporre una risposta. Ho però trovato ` +
          `${sources.length === 1 ? "un elemento" : `${sources.length} elementi`} ` +
          `che contengono i termini della domanda: sono elencati qui sotto e puoi aprirli.`,
        citations: sources.map((_, index) => index),
        unknown: true,
      },
      sources: sources.map((source) => ({
        workItemId: source.workItemId,
        title: source.title,
      })),
      failureCause: null,
      message: "",
    };
  }

  const outcome = await answerProjectQuestion({
    gateway,
    question,
    sources,
    language: input.agent.language,
    maxTokens: effectiveTokenBudget(input.agent.policy, PROJECT_QA_BUDGET),
  });

  if (!outcome.ok) {
    await record({ status: "failed", failureCause: outcome.failureCause, ...outcome.usage });

    return {
      ok: false,
      skillRunId: runId,
      answer: null,
      sources: [],
      failureCause: outcome.failureCause,
      message: outcome.message,
    };
  }

  await record({ status: "succeeded", failureCause: null, ...outcome.usage });

  return {
    ok: true,
    skillRunId: runId,
    answer: outcome.answer,
    sources: citedFrom(outcome.answer, sources),
    failureCause: null,
    message: "",
  };
}
