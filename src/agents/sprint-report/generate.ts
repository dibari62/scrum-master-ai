import {
  reportContentSchema,
  type CitableValue,
  type MetricSnapshot,
  type ReportContent,
  type SkillRunFailureCause,
  type SprintReport,
} from "@/domain";
import type { Gateway, UntrustedBlock } from "@/lib/llm";

import { checkNumericFidelity } from "./fidelity";
import { hasNarratableContent } from "./snapshot";

/**
 * Producing a sprint report: compose, ask, and refuse what comes back wrong.
 *
 * The order matters more than any single step. The model is asked last and
 * trusted least: everything it may quote was computed before it was called, and
 * everything it wrote is checked before anyone sees it.
 *
 * Nothing here touches a database or a network. The gateway arrives as an
 * argument, which is what lets the whole pipeline — including every refusal —
 * be exercised without a vendor, a key or a table.
 */

/** `AGENTS.md` §9: every skill declares its ceiling. */
export const SPRINT_REPORT_BUDGET = 6000;

/**
 * The instructions. Versioned here, never assembled from ingested text.
 *
 * The prohibitions are stated as things the model *cannot* do rather than
 * should not, and each is backed by a check that runs afterwards — because a
 * prompt is a request, and a request is not a control. Writing them down still
 * matters: it makes the refusals rare instead of constant.
 */
const SYSTEM_PROMPT = [
  "Sei lo Scrum Master AI di un progetto software e scrivi il resoconto di uno sprint",
  "per un destinatario esterno al team, che non conosce il gergo e non ha visto alcuna dashboard.",
  "",
  "Regole assolute:",
  "1. Puoi citare SOLTANTO i valori che ti vengono forniti, scritti esattamente come li ricevi.",
  "   Non calcolare, non sommare, non arrotondare, non convertire, non stimare alcun numero.",
  "   Se una cifra non è nell'elenco dei valori, non può comparire nel testo.",
  "2. Riferisci le lacune che ti vengono indicate: una metrica assente va detta, mai sostituita con zero.",
  "3. Non nominare persone e non attribuire meriti o colpe a nessuno. Si descrive il processo.",
  "4. Non dedurre stati d'animo, motivazione o clima di nessuno.",
  "5. Osserva, non consigliare: descrivi ciò che i numeri mostrano, non cosa andrebbe fatto.",
  "",
  "Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo, in questa forma:",
  '{"summary": "...", "flow": "...", "attentionPoints": [{"metricId": "...", "observation": "..."}]}',
  "",
  "`summary` racconta com'è andato lo sprint. `flow` racconta come si è mosso il lavoro:",
  "durate, attese, rilavorazione. `attentionPoints` contiene al massimo cinque osservazioni,",
  "ognuna ancorata all'identificativo di una metrica fra quelle fornite.",
].join("\n");

function renderValues(values: readonly CitableValue[]): string {
  return values.map((value) => `- ${value.label} (${value.metricId}): ${value.text}`).join("\n");
}

/**
 * Builds the question.
 *
 * Evidence never appears here. It travels as untrusted blocks so the gateway can
 * delimit and label it, which is what keeps a work item's title a thing to read
 * rather than a thing to obey (§8.1).
 */
export function composePrompt(snapshot: MetricSnapshot, projectName: string): string {
  const parts = [
    `Progetto: ${projectName}`,
    `Sprint: ${snapshot.sprintName}`,
    "",
    "Valori misurati, gli unici che puoi citare:",
    renderValues(snapshot.values),
  ];

  if (snapshot.gaps.length > 0) {
    parts.push(
      "",
      "Metriche non calcolabili per questo sprint. Vanno riferite come tali:",
      snapshot.gaps.map((gap) => `- ${gap.label}: ${gap.explanation}`).join("\n"),
    );
  }

  if (snapshot.evidenceTruncated) {
    parts.push(
      "",
      "L'elenco degli elementi è stato ridotto per rispettare il budget:",
      "dichiara che l'osservazione si basa su un sottoinsieme.",
    );
  }

  return parts.join("\n");
}

/**
 * The items, as material to read.
 *
 * One block, labelled. The reason for each item is written by the code and sits
 * beside the title, so the model can group without interpreting.
 */
export function composeUntrusted(snapshot: MetricSnapshot): readonly UntrustedBlock[] {
  if (snapshot.evidence.length === 0) return [];

  return [
    {
      label: "elementi dello sprint",
      content: snapshot.evidence
        .map((entry) => `[${entry.reason}] ${entry.title}`)
        .join("\n"),
    },
  ];
}

/**
 * Reads the answer as JSON, tolerating a fenced code block.
 *
 * Models wrap JSON in triple backticks often enough that refusing on it would
 * mean refusing correct answers over punctuation. Anything beyond that is a
 * malformed answer and is treated as one.
 */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** Every piece of prose the model produced, for the fidelity check to read. */
function proseOf(content: ReportContent): string {
  return [
    content.summary,
    content.flow,
    ...content.attentionPoints.map((point) => point.observation),
  ].join("\n");
}

export type GenerateUsage = {
  readonly provider: "gemini" | "groq" | "fake" | null;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly durationMs: number;
};

const NO_USAGE: GenerateUsage = {
  provider: null,
  model: null,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  durationMs: 0,
};

export type GenerateOutcome =
  | { readonly ok: true; readonly report: SprintReport; readonly usage: GenerateUsage }
  | {
      readonly ok: false;
      readonly failureCause: SkillRunFailureCause;
      readonly message: string;
      readonly usage: GenerateUsage;
    };

/**
 * The report a sprint with nothing in it deserves.
 *
 * Written by the code and marked as such. Asking a model to say "there is
 * nothing to report" spends tokens to be told what is already known, and would
 * present as generated a sentence that was not.
 */
function composeEmptyReport(snapshot: MetricSnapshot): SprintReport {
  const gapLines =
    snapshot.gaps.length > 0
      ? snapshot.gaps.map((gap) => `${gap.label}: ${gap.explanation}`).join("; ")
      : "non risultano metriche calcolabili";

  return {
    origin: "code",
    content: {
      summary:
        `Per lo sprint «${snapshot.sprintName}» non ci sono misure su cui basare un resoconto. ` +
        `Nessun numero è stato prodotto, e nessuno è stato inventato per riempire lo spazio.`,
      flow:
        `Non è possibile descrivere come si è mosso il lavoro: ${gapLines}. ` +
        `Quando lo sprint conterrà elementi con una storia di stati, queste misure diventeranno disponibili.`,
      attentionPoints: [],
    },
    snapshot,
  };
}

export type GenerateInput = {
  readonly gateway: Gateway;
  readonly snapshot: MetricSnapshot;
  readonly projectName: string;
  readonly language: string;
  readonly maxTokens: number;
  /**
   * The canned answer for the deterministic provider.
   *
   * Present so the skill can be demonstrated without a vendor. A real provider
   * never sees it.
   */
  readonly stubResponse?: string | undefined;
};

export async function generateSprintReport(input: GenerateInput): Promise<GenerateOutcome> {
  if (!hasNarratableContent(input.snapshot)) {
    return { ok: true, report: composeEmptyReport(input.snapshot), usage: NO_USAGE };
  }

  const outcome = await input.gateway.complete({
    system: SYSTEM_PROMPT,
    prompt: composePrompt(input.snapshot, input.projectName),
    untrustedData: composeUntrusted(input.snapshot),
    maxTokens: input.maxTokens,
    language: input.language,
    stubResponse: input.stubResponse,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      failureCause: outcome.failureCause,
      message: outcome.message,
      usage: outcome,
    };
  }

  const usage: GenerateUsage = {
    provider: outcome.provider,
    model: outcome.model,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    estimatedCostUsd: outcome.estimatedCostUsd,
    durationMs: outcome.durationMs,
  };

  const parsed = reportContentSchema.safeParse(parseJson(outcome.text));
  if (!parsed.success) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message: "La risposta non rispettava il formato richiesto e non è stata salvata.",
      usage,
    };
  }

  const content = parsed.data;

  /*
   * The refusal this whole file exists for.
   *
   * A figure nobody computed is not a blemish to flag and publish anyway: it is
   * the exact damage the product is built to avoid, and it arrives inside a
   * fluent sentence that nobody would question. Spec §11 Q6 chose the strict
   * option deliberately — on a correctness constraint the permissive one is
   * never taken quietly.
   */
  const fidelity = checkNumericFidelity(proseOf(content), input.snapshot.values, [
    input.snapshot.sprintName,
    input.projectName,
  ]);
  if (!fidelity.faithful) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        `Il resoconto citava numeri che nessuna metrica ha prodotto ` +
        `(${fidelity.strangers.join(", ")}) e non è stato salvato.`,
      usage,
    };
  }

  // An observation anchored to a metric that is missing, or absent from this
  // sprint, points at nothing a reader can go and check.
  const known = new Set(input.snapshot.values.map((value) => value.metricId));
  const dangling = content.attentionPoints.filter((point) => !known.has(point.metricId));

  if (dangling.length > 0) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        `Il resoconto conteneva osservazioni su metriche non disponibili ` +
        `(${dangling.map((point) => point.metricId).join(", ")}) e non è stato salvato.`,
      usage,
    };
  }

  return { ok: true, report: { origin: "model", content, snapshot: input.snapshot }, usage };
}
