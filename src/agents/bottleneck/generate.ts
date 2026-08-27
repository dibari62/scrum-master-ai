import {
  bottleneckNarrativeSchema,
  type BottleneckNarrative,
  type LlmProvider,
  type SkillRunFailureCause,
} from "@/domain";
import { checkNumericFidelity } from "@/agents/sprint-report";
import type { Gateway } from "@/lib/llm";

import {
  hasFlowToDescribe,
  type BottleneckSnapshot,
  type StageFacts,
} from "./snapshot";

/**
 * Explaining where the work piles up.
 *
 * The engine decided **which** phase absorbs the most waiting, and that decision
 * is not reopened here: the model is given it, and an answer that names a
 * different phase is refused rather than shown. What the model adds is the
 * sentence a reader can act on.
 *
 * Nothing in this file touches a database or a network.
 */

/** `AGENTS.md` §9: every skill declares its ceiling. */
export const BOTTLENECK_BUDGET = 3000;

const SYSTEM_PROMPT = [
  "Sei lo Scrum Master AI di un progetto software e spieghi, a chi non fa parte del team,",
  "in quale fase del flusso il lavoro resta fermo più a lungo.",
  "",
  "Regole assolute:",
  "1. La fase che costituisce il collo di bottiglia ti viene indicata: non sceglierne un'altra.",
  "   Se ti viene detto che nessuna fase di attesa è emersa, non nominarne alcuna.",
  "2. Puoi citare SOLTANTO i valori che ti vengono forniti, scritti esattamente come li ricevi.",
  "   Non calcolare, non sommare, non arrotondare, non convertire, non stimare alcun numero.",
  "3. Il collo di bottiglia si cerca fra le fasi di ATTESA, mai fra quelle di lavorazione:",
  "   dire che l'ostacolo a finire il lavoro è farlo non aiuta nessuno.",
  "4. Non nominare persone e non attribuire meriti o colpe a nessuno. Si descrive il processo.",
  "5. Non dedurre stati d'animo, motivazione o clima di nessuno.",
  "6. Osserva, non consigliare: descrivi ciò che le misure mostrano, non cosa andrebbe fatto.",
  "",
  "Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo, in questa forma:",
  '{"situation": "...", "worstWait": "in_review", "observations": [{"state": "...", "observation": "..."}]}',
  "",
  "`situation` descrive dove va il tempo nel suo insieme. `worstWait` è l'identificativo della",
  "fase indicata come collo di bottiglia, da omettere se non ne è stata indicata alcuna.",
  "`observations` contiene al massimo tre letture, ognuna ancorata a una fase fra quelle fornite.",
].join("\n");

function renderStage(stage: StageFacts): string {
  const parts = [
    `quota ${stage.share}`,
    `totale ${stage.total}`,
    stage.median === null ? null : `sosta mediana ${stage.median}`,
    `${stage.itemCount} elementi`,
    stage.valueAdding ? "fase di lavorazione" : "fase di attesa",
  ].filter((part) => part !== null);

  return `- ${stage.label} (${stage.state}): ${parts.join(", ")}`;
}

export function composeBottleneckPrompt(snapshot: BottleneckSnapshot): string {
  const parts = [
    `Progetto: ${snapshot.projectName}`,
    `Quota di tempo in cui qualcuno sta effettivamente lavorando: ${snapshot.valueAddingShare}`,
    "",
    "Fasi osservate, dalla più costosa in tempo alla meno costosa:",
    snapshot.stages.map(renderStage).join("\n"),
    "",
  ];

  if (snapshot.worstWait === null) {
    /*
     * L'assenza si dichiara, non si lascia dedurre.
     *
     * Un modello a cui non si dice nulla presume che un collo di bottiglia
     * esista e ne sceglie uno: quello meno buono diventa così un problema, che
     * è esattamente la promozione che il motore rifiuta di fare.
     */
    parts.push(
      "Nessuna fase di attesa è emersa come collo di bottiglia: il tempo non si accumula",
      "in una fase di attesa in particolare. Non nominare alcuna fase come collo di bottiglia",
      "e ometti il campo `worstWait`.",
    );
  } else {
    parts.push(
      `Collo di bottiglia individuato dal codice: ${snapshot.worstWait.label} ` +
        `(${snapshot.worstWait.state}), che assorbe ${snapshot.worstWait.share} del tempo misurato.`,
    );
  }

  return parts.join("\n");
}

/**
 * The explanation the code can write on its own.
 *
 * Without a vendor key there is still something true and useful to say: which
 * phase holds the work longest and how little of the total is actual work. The
 * reading is what is missing, so it is not claimed.
 */
export function composeCodeNarrative(snapshot: BottleneckSnapshot): BottleneckNarrative {
  const worst = snapshot.worstWait;

  const opening =
    worst === null
      ? `In questo progetto nessuna fase di attesa trattiene il lavoro più delle altre in modo ` +
        `evidente: il tempo non si accumula in un punto solo.`
      : `Il lavoro resta fermo più a lungo in «${worst.label}», che da sola assorbe ` +
        `${worst.share} del tempo misurato fra la presa in carico e la chiusura.`;

  const situation =
    `${opening} Complessivamente, ${snapshot.valueAddingShare} del tempo è lavorazione vera: ` +
    `il resto è attesa. Il collo di bottiglia si cerca solo fra le fasi di attesa, perché ` +
    `chiamare così la lavorazione significherebbe dire che l'ostacolo a finire il lavoro è farlo.`;

  const observations = snapshot.stages
    .filter((stage) => !stage.valueAdding)
    .slice(0, 3)
    .map((stage) => ({
      state: stage.state,
      observation:
        `${stage.label}: ${stage.share} del tempo totale (${stage.total})` +
        `${stage.median === null ? "" : `, con una sosta mediana di ${stage.median}`}.`,
    }));

  return worst === null
    ? { situation, observations }
    : { situation, worstWait: worst.state, observations };
}

function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function proseOf(narrative: BottleneckNarrative): string {
  return [
    narrative.situation,
    ...narrative.observations.map((observation) => observation.observation),
  ].join("\n");
}

export type BottleneckUsage = {
  readonly provider: LlmProvider | null;
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly durationMs: number;
};

export type BottleneckOutcome =
  | {
      readonly ok: true;
      readonly narrative: BottleneckNarrative;
      readonly usage: BottleneckUsage;
    }
  | {
      readonly ok: false;
      readonly failureCause: SkillRunFailureCause;
      readonly message: string;
      readonly usage: BottleneckUsage;
    };

const NO_USAGE: BottleneckUsage = {
  provider: null,
  model: null,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  durationMs: 0,
};

export type NarrateBottleneckInput = {
  readonly gateway: Gateway;
  readonly snapshot: BottleneckSnapshot;
  readonly language: string;
  readonly maxTokens: number;
  readonly stubResponse?: string | undefined;
};

export async function narrateBottleneck(
  input: NarrateBottleneckInput,
): Promise<BottleneckOutcome> {
  if (!hasFlowToDescribe(input.snapshot)) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        "Nessun elemento ha ancora attraversato il flusso: non c'è un percorso da descrivere.",
      usage: NO_USAGE,
    };
  }

  const outcome = await input.gateway.complete({
    system: SYSTEM_PROMPT,
    prompt: composeBottleneckPrompt(input.snapshot),
    /*
     * Nessun testo di terzi entra qui: ogni fase è una durata calcolata dalle
     * transizioni di stato, non un titolo o un commento scritto da qualcuno
     * (§8.1).
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

  const usage: BottleneckUsage = {
    provider: outcome.provider,
    model: outcome.model,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    estimatedCostUsd: outcome.estimatedCostUsd,
    durationMs: outcome.durationMs,
  };

  const parsed = bottleneckNarrativeSchema.safeParse(parseJson(outcome.text));
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
    input.snapshot.projectName,
  ]);

  if (!fidelity.faithful) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        `La spiegazione citava numeri che nessuna misura ha prodotto ` +
        `(${fidelity.strangers.join(", ")}) e non è stata mostrata.`,
      usage,
    };
  }

  /*
   * Il rifiuto per cui questa skill esiste.
   *
   * Il collo di bottiglia è una decisione già presa dal codice, con una regola
   * dichiarata: si sceglie solo fra le fasi di attesa. Lasciare che il modello
   * ne indichi un'altra riaprirebbe quella decisione in silenzio — e la
   * riaprirebbe proprio dove è più facile sbagliarla, perché la lavorazione è
   * quasi sempre la fase che consuma più tempo in assoluto.
   */
  const expected = input.snapshot.worstWait?.state;

  if (narrative.worstWait !== expected) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        expected === undefined
          ? "La spiegazione indicava un collo di bottiglia dove il codice non ne ha trovato alcuno."
          : `La spiegazione indicava una fase diversa da quella misurata e non è stata mostrata.`,
      usage,
    };
  }

  // Un'osservazione su una fase mai osservata parla di qualcosa che non è
  // stato misurato.
  const known = new Set(input.snapshot.stages.map((stage) => stage.state));
  const dangling = narrative.observations.filter(
    (observation) => !known.has(observation.state),
  );

  if (dangling.length > 0) {
    return {
      ok: false,
      failureCause: "invalid_output",
      message:
        `La spiegazione era ancorata a fasi mai osservate ` +
        `(${dangling.map((observation) => observation.state).join(", ")}) e non è stata mostrata.`,
      usage,
    };
  }

  return { ok: true, narrative, usage };
}
