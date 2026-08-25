import { describe, expect, it } from "vitest";

import { bottleneckNarrativeSchema } from "@/domain";
import {
  BOTTLENECK_BUDGET,
  buildBottleneckSnapshot,
  composeBottleneckPrompt,
  composeCodeNarrative,
  narrateBottleneck,
  type BottleneckSnapshot,
} from "@/agents/bottleneck";
import type { Bottleneck, Milliseconds } from "@/metrics";
import type { Gateway, LlmRequest } from "@/lib/llm";

/**
 * Explaining where the work waits — and refusing to move the answer.
 *
 * The engine already chose the bottleneck, and it chose it **only among waiting
 * phases**. These tests defend that choice against the model, because the phase
 * that consumes the most time in absolute terms is almost always the one where
 * somebody is working: a narration free to point at it would keep telling teams
 * that the obstacle to finishing the work is doing it.
 */

const HOUR = 3_600_000 as Milliseconds;

const MEASURED: Bottleneck = {
  stages: [
    {
      state: "in_review",
      totalMs: (73 * HOUR) as Milliseconds,
      share: 0.73,
      medianMs: { available: true, value: (5 * HOUR) as Milliseconds, sampleSize: 12 },
      itemCount: 12,
      valueAdding: false,
    },
    {
      state: "in_progress",
      totalMs: (16 * HOUR) as Milliseconds,
      share: 0.16,
      medianMs: { available: true, value: (2 * HOUR) as Milliseconds, sampleSize: 12 },
      itemCount: 12,
      valueAdding: true,
    },
    {
      state: "blocked",
      totalMs: (11 * HOUR) as Milliseconds,
      share: 0.11,
      medianMs: { available: true, value: (3 * HOUR) as Milliseconds, sampleSize: 4 },
      itemCount: 4,
      valueAdding: false,
    },
  ],
  worstWait: {
    state: "in_review",
    totalMs: (73 * HOUR) as Milliseconds,
    share: 0.73,
    medianMs: { available: true, value: (5 * HOUR) as Milliseconds, sampleSize: 12 },
    itemCount: 12,
    valueAdding: false,
  },
  valueAddingShare: 0.16,
};

const NO_WAIT: Bottleneck = {
  stages: [MEASURED.stages[1] as (typeof MEASURED.stages)[number]],
  worstWait: null,
  valueAddingShare: 1,
};

function snapshotOf(measured: Bottleneck = MEASURED): BottleneckSnapshot {
  return buildBottleneckSnapshot({ projectName: "Checkout", bottleneck: measured });
}

function stubGateway(text: string): { gateway: Gateway; seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];

  return {
    seen,
    gateway: {
      complete: (request) => {
        seen.push(request);
        return Promise.resolve({
          ok: true as const,
          text,
          provider: "fake" as const,
          model: "fake-deterministic-1",
          inputTokens: 90,
          outputTokens: 40,
          estimatedCostUsd: 0,
          durationMs: 8,
        });
      },
    },
  };
}

const LONG =
  "Il lavoro attraversa il flusso senza fermarsi nella lavorazione, ma resta a lungo in attesa " +
  "prima di essere chiuso: è nelle attese che si accumula la maggior parte del tempo misurato.";

async function narrate(answer: unknown, snapshot: BottleneckSnapshot = snapshotOf()) {
  const { gateway } = stubGateway(typeof answer === "string" ? answer : JSON.stringify(answer));

  return narrateBottleneck({
    gateway,
    snapshot,
    language: "it",
    maxTokens: BOTTLENECK_BUDGET,
  });
}

describe("istantanea del flusso", () => {
  it("scrive le quote già formattate", () => {
    const texts = snapshotOf().values.map((value) => value.text);

    expect(texts).toContain("73%");
    expect(texts).toContain("16%");
  });

  it("porta il collo di bottiglia scelto dal motore, non il più costoso", () => {
    const snapshot = snapshotOf();

    // «In lavorazione» pesa più di «Bloccato», ma non è un'attesa: il collo di
    // bottiglia resta «In revisione».
    expect(snapshot.worstWait?.state).toBe("in_review");
  });

  it("dichiara l'assenza quando nessuna fase di attesa emerge", () => {
    expect(snapshotOf(NO_WAIT).worstWait).toBeNull();
  });
});

describe("la richiesta", () => {
  it("nomina la fase scelta dal codice", () => {
    expect(composeBottleneckPrompt(snapshotOf())).toContain("Collo di bottiglia individuato");
  });

  it("dichiara l'assenza invece di tacerla", () => {
    const prompt = composeBottleneckPrompt(snapshotOf(NO_WAIT));

    expect(prompt).toContain("Nessuna fase di attesa è emersa");
  });

  it("non trasporta alcun testo scritto da terzi", async () => {
    const { gateway, seen } = stubGateway(
      JSON.stringify({ situation: LONG, worstWait: "in_review", observations: [] }),
    );

    await narrateBottleneck({
      gateway,
      snapshot: snapshotOf(),
      language: "it",
      maxTokens: BOTTLENECK_BUDGET,
    });

    expect(seen[0]?.untrustedData).toEqual([]);
  });
});

describe("i rifiuti", () => {
  it("accetta la risposta che indica la fase misurata", async () => {
    const outcome = await narrate({
      situation: `${LONG} La revisione assorbe il 73% del tempo.`,
      worstWait: "in_review",
      observations: [
        {
          state: "in_review",
          observation: "La revisione trattiene il lavoro più a lungo di ogni altra fase.",
        },
      ],
    });

    expect(outcome.ok).toBe(true);
  });

  it("rifiuta una fase diversa da quella misurata", async () => {
    const outcome = await narrate({
      situation: LONG,
      worstWait: "blocked",
      observations: [],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("diversa da quella misurata");
  });

  it("rifiuta di promuovere la lavorazione a collo di bottiglia", async () => {
    // Il caso che questa skill esiste per impedire: la fase in cui si lavora è
    // spesso la più lunga in assoluto, e indicarla direbbe a una squadra che
    // l'ostacolo a finire il lavoro è farlo.
    const outcome = await narrate({
      situation: LONG,
      worstWait: "in_progress",
      observations: [],
    });

    expect(outcome.ok).toBe(false);
  });

  it("rifiuta un collo di bottiglia dove il codice non ne ha trovato alcuno", async () => {
    const outcome = await narrate(
      { situation: LONG, worstWait: "in_progress", observations: [] },
      snapshotOf(NO_WAIT),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("non ne ha trovato alcuno");
  });

  it("rifiuta un numero che nessuna misura ha prodotto", async () => {
    const outcome = await narrate({
      situation: `${LONG} Restano 47 elementi in coda.`,
      worstWait: "in_review",
      observations: [],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("47");
  });

  it("rifiuta un'osservazione su una fase mai osservata", async () => {
    const outcome = await narrate({
      situation: LONG,
      worstWait: "in_review",
      observations: [
        { state: "cancelled", observation: "Gli elementi annullati restano fermi a lungo." },
      ],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("cancelled");
  });
});

describe("la spiegazione che il codice scrive da sé", () => {
  it("rispetta lo stesso schema preteso dal modello", () => {
    expect(bottleneckNarrativeSchema.safeParse(composeCodeNarrative(snapshotOf())).success).toBe(
      true,
    );
  });

  it("indica la fase misurata e la sua quota", () => {
    const narrative = composeCodeNarrative(snapshotOf());

    expect(narrative.worstWait).toBe("in_review");
    expect(narrative.situation).toContain("73%");
  });

  it("non indica alcuna fase quando non ne è emersa una", () => {
    const narrative = composeCodeNarrative(snapshotOf(NO_WAIT));

    expect(narrative.worstWait).toBeUndefined();
    expect(narrative.situation).toContain("nessuna fase di attesa");
  });

  it("osserva solo le fasi di attesa", () => {
    const states = composeCodeNarrative(snapshotOf()).observations.map((o) => o.state);

    expect(states).toContain("in_review");
    expect(states).not.toContain("in_progress");
  });
});
