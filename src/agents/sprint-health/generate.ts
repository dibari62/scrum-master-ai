import {
  healthNarrativeSchema,
  type HealthNarrative,
  type LlmProvider,
  type SkillRunFailureCause,
} from "@/domain";
import { checkNumericFidelity } from "@/agents/sprint-report";
import type { Gateway } from "@/lib/llm";

import { isNarratable, type HealthSnapshot, type SignalFacts } from "./snapshot";

/**
 * Explaining a verdict the code has already reached.
 *
 * The judgement is not asked for and cannot be changed here: it arrives
 * computed, and the model is given the job of joining the signals into
 * something a person can read. Everything it writes is checked before anyone
 * sees it, and a check that fails is a refusal — not a warning printed above the
 * text.
 *
 * Nothing in this file touches a database or a network.
 */

/** `AGENTS.md` §9: every skill declares its ceiling. */
export const SPRINT_HEALTH_BUDGET = 3000;

/**
 * The instructions.
 *
 * Shorter than the sprint report's because the input is smaller and the task
 * narrower — and because the prohibitions that matter are enforced afterwards
 * anyway. A prompt is a request; a check is a control.
 */
const SYSTEM_PROMPT = [
  "Sei lo Scrum Master AI di un progetto software e spieghi, a chi non fa parte del team,",
  "un giudizio sulla salute di uno sprint in corso che è già stato calcolato dal codice.",
  "",
  "Regole assolute:",
  "1. Il giudizio ti viene dato: non puoi cambiarlo, contraddirlo né ammorbidirlo.",
  "   Il tuo compito è spiegare perché i segnali portano a quel giudizio.",
  "2. Puoi citare SOLTANTO i valori che ti vengono forniti, scritti esattamente come li ricevi.",
  "   Non calcolare, non sommare, non arrotondare, non convertire, non stimare alcun numero.",
  "3. Metti in relazione i segnali fra loro: è questo che aggiungi a un elenco già visibile.",
  "   Non limitarti a ripetere un segnale alla volta.",
  "4. Non nominare persone e non attribuire meriti o colpe a nessuno. Si descrive il processo.",
  "5. Non dedurre stati d'animo, motivazione o clima di nessuno.",
  "6. Osserva, non consigliare: descrivi ciò che i segnali mostrano, non cosa andrebbe fatto.",
  "7. Se non ti vengono forniti giudizi precedenti, ometti del tutto il campo `trend`:",
  "   senza storia non esiste un andamento da descrivere e inventarne uno è un errore grave.",
  "",
  "Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo, in questa forma:",
  '{"situation": "...", "observations": [{"signalId": "...", "observation": "..."}], "trend": "..."}',
  "",
  "`situation` descrive lo sprint nel suo insieme. `observations` contiene al massimo quattro",
  "letture, ognuna ancorata all'identificativo di un segnale fra quelli forniti.",
  "`trend` dice come il giudizio si è mosso rispetto ai controlli precedenti.",
].join("\n");

const STATUS_WORDS = {
  respected: "entro la soglia",
  watch: "oltre la soglia",
  critical: "ben oltre la soglia",
  "not-evaluable": "non valutabile",
} as const;

function renderSignal(signal: SignalFacts): string {
  if (signal.status === "not-evaluable") {
    return `- ${signal.title} (${signal.id}): non valutabile — ${signal.missing ?? "manca il dato necessario"}`;
  }

  const figures = [
    signal.measured === null ? null : `misurato ${signal.measured}`,
    signal.threshold === null ? null : `soglia ${signal.threshold}`,
  ]
    .filter((part) => part !== null)
    .join(", ");

  return `- ${signal.title} (${signal.id}): ${STATUS_WORDS[signal.status]}${figures ? ` — ${figures}` : ""}`;
}

export function composeHealthPrompt(snapshot: HealthSnapshot, projectName: string): string {
  const parts = [
    `Progetto: ${projectName}`,
    `Sprint in corso: ${snapshot.sprintName}`,
    `Quota di sprint trascorsa: ${snapshot.elapsed}`,
    "",
    `Giudizio calcolato dal codice: ${snapshot.verdictLabel} — ${snapshot.verdictSummary}`,
    "",
    "Segnali osservati:",
    snapshot.signals.map(renderSignal).join("\n"),
  ];

  if (snapshot.history.length > 0) {
    parts.push(
      "",
      "Giudizi precedenti su questo stesso sprint, dal più vecchio al più recente:",
      snapshot.history.map((point) => `- ${point.date}: ${point.verdictLabel}`).join("\n"),
    );
  } else {
    /*
     * The absence is stated, not left to be noticed.
     *
     * Silence about the history is what a model fills in: told nothing, it
     * assumes there was something and describes it. Told explicitly that there
     * is nothing, it has a fact to relay instead of a hole to close.
     */
    parts.push(
      "",
      "Non esiste alcun giudizio precedente su questo sprint: il controllo automatico non è",
      "ancora stato eseguito. Non descrivere alcun andamento e ometti il campo `trend`.",
    );
  }

  return parts.join("\n");
}

/** Reads the answer as JSON, tolerating a fenced code block. */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function proseOf(narrative: HealthNarrative): string {
  return [
    narrative.situation,
    ...narrative.observations.map((observation) => observation.observation),
    narrative.trend ?? "",
  ].join("\n");
}

export type HealthUsage = {
  readonly provider: LlmProvider | null;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly durationMs: number;
};

const NO_USAGE: HealthUsage = {
  provider: null,
  model: null,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  durationMs: 0,
};

/**
 * Who wrote the text.
 *
 * Shown to the reader, and not as a courtesy. Without it the interface printed
 * «generato da un modello linguistico» above a paragraph the code had written —
 * a claim that was false, and false in the direction that flatters the product.
 */
export type NarrationOrigin = "model" | "code";

export type NarrateOutcome =
  | {
      readonly ok: true;
      readonly narrative: HealthNarrative;
      readonly origin: NarrationOrigin;
      readonly usage: HealthUsage;
    }
  | {
      readonly ok: false;
      readonly failureCause: SkillRunFailureCause;
      readonly message: string;
      readonly usage: HealthUsage;
    };

/**
 * The explanation the code can write on its own.
 *
 * **Why this exists, and why it is not a placeholder.** Without a vendor key the
 * gateway answers with a canned string, and what reached the reader was a
 * paragraph explaining that there was nothing to explain. Pressing a button to
 * be told the button does not work is worse than not offering it.
 *
 * Two of the three things this skill promises do **not** need a model at all:
 * naming the signals that are past their threshold, and saying how the verdict
 * has moved. The code holds both. What it cannot do is join them into a reading
 * — so it does not pretend to, and says who wrote it.
 */
export function composeCodeNarrative(snapshot: HealthSnapshot): HealthNarrative {
  const breached = snapshot.signals.filter(
    (signal) => signal.status === "critical" || signal.status === "watch",
  );

  const unmeasured = snapshot.signals.filter((signal) => signal.status === "not-evaluable");

  const counted =
    breached.length === 0
      ? "Nessun segnale supera la propria soglia."
      : breached.length === 1
        ? "Un segnale supera la propria soglia."
        : `${breached.length} segnali superano la propria soglia.`;

  const missing =
    unmeasured.length === 0
      ? ""
      : ` ${unmeasured.length === 1 ? "Un segnale non è valutabile" : `${unmeasured.length} segnali non sono valutabili`}: ` +
        `l'assenza di un dato non è un risultato sereno, è l'assenza di un risultato.`;

  const situation =
    `A ${snapshot.elapsed} di sprint trascorso il giudizio è «${snapshot.verdictLabel}». ` +
    `${counted} Il verdetto corrisponde sempre al segnale messo peggio, mai alla media: ` +
    `una media lascerebbe che i segnali sereni coprano quello serio.${missing}`;

  const observations = breached.slice(0, 4).map((signal) => {
    const figures = [
      signal.measured === null ? null : `misurato ${signal.measured}`,
      signal.threshold === null ? null : `soglia ${signal.threshold}`,
    ]
      .filter((part) => part !== null)
      .join(", ");

    const severity =
      signal.status === "critical" ? "è ben oltre la soglia" : "ha superato la soglia";

    return {
      signalId: signal.id,
      observation: `${signal.title} ${severity}${figures ? ` (${figures})` : ""}.`,
    };
  });

  /*
   * L'andamento è un calcolo, non un'interpretazione.
   *
   * Confrontare il verdetto di oggi con l'ultimo conservato è aritmetica sui
   * giudizi già presi: il codice lo sa fare, ed è proprio l'informazione che la
   * dashboard oggi affida a una fila di pallini colorati da contare a occhio.
   */
  const previous = snapshot.history[snapshot.history.length - 1];

  const trend =
    previous === undefined
      ? undefined
      : previous.verdictLabel === snapshot.verdictLabel
        ? `Il giudizio è «${snapshot.verdictLabel}» già dal controllo del ${previous.date}: ` +
          `non è un peggioramento improvviso, è una situazione che dura.`
        : `Al controllo del ${previous.date} il giudizio era «${previous.verdictLabel}», ` +
          `oggi è «${snapshot.verdictLabel}».`;

  return trend === undefined
    ? { situation, observations }
    : { situation, observations, trend };
}

export type NarrateInput = {
  readonly gateway: Gateway;
  readonly snapshot: HealthSnapshot;
  readonly projectName: string;
  readonly language: string;
  readonly maxTokens: number;
  readonly stubResponse?: string | undefined;
};

export async function narrateSprintHealth(input: NarrateInput): Promise<NarrateOutcome> {
  if (!isNarratable(input.snapshot)) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        "Il giudizio è «non valutabile»: non ci sono segnali misurati da spiegare, " +
        "e una narrazione su un giudizio assente suonerebbe come un giudizio.",
      usage: NO_USAGE,
    };
  }

  const outcome = await input.gateway.complete({
    system: SYSTEM_PROMPT,
    prompt: composeHealthPrompt(input.snapshot, input.projectName),
    /*
     * No untrusted data at all, and it is worth saying why there is none.
     *
     * Unlike a sprint report, this skill never shows the model an item title or
     * a comment: every signal is a number the engine computed. There is
     * therefore no text written by a third party in this prompt, and so no
     * surface for indirect prompt injection (§8.1).
     */
    untrustedData: [],
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

  const usage: HealthUsage = {
    provider: outcome.provider,
    model: outcome.model,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    estimatedCostUsd: outcome.estimatedCostUsd,
    durationMs: outcome.durationMs,
  };

  const parsed = healthNarrativeSchema.safeParse(parseJson(outcome.text));
  if (!parsed.success) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message: "La risposta non rispettava il formato richiesto e non è stata mostrata.",
      usage,
    };
  }

  const narrative = parsed.data;

  const fidelity = checkNumericFidelity(proseOf(narrative), input.snapshot.values, [
    input.snapshot.sprintName,
    input.projectName,
    ...input.snapshot.history.map((point) => point.date),
  ]);

  if (!fidelity.faithful) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        `La spiegazione citava numeri che nessun segnale ha prodotto ` +
        `(${fidelity.strangers.join(", ")}) e non è stata mostrata.`,
      usage,
    };
  }

  /*
   * The refusal this increment exists for (spec criterio 3).
   *
   * With no earlier check there is no trend, and a model asked how something
   * changed will describe a change anyway. That failure is worse than a wrong
   * number: a number can be compared against the dashboard, while an invented
   * history has nothing to be compared against at all.
   */
  if (input.snapshot.history.length === 0 && narrative.trend !== undefined) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        "La spiegazione descriveva un andamento nel tempo, ma su questo sprint non " +
        "esiste alcun giudizio precedente: sarebbe stato inventato.",
      usage,
    };
  }

  /*
   * An observation anchored to a signal that could not be evaluated is a comment
   * on a measurement that does not exist.
   */
  const measurable = new Set(
    input.snapshot.signals
      .filter((signal) => signal.status !== "not-evaluable")
      .map((signal) => signal.id),
  );

  const dangling = narrative.observations.filter(
    (observation) => !measurable.has(observation.signalId),
  );

  if (dangling.length > 0) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        `La spiegazione era ancorata a segnali non misurati ` +
        `(${dangling.map((observation) => observation.signalId).join(", ")}) e non è stata mostrata.`,
      usage,
    };
  }

  return { ok: true, narrative, origin: "model", usage };
}
