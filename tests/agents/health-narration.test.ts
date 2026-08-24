import { describe, expect, it } from "vitest";

import { healthSignalIdSchema } from "@/domain";
import {
  SPRINT_HEALTH_BUDGET,
  buildHealthSnapshot,
  composeHealthPrompt,
  isNarratable,
  narrateSprintHealth,
  type HealthSnapshot,
} from "@/agents/sprint-health";
import type { SprintHealth } from "@/metrics";
import type { Gateway, LlmRequest } from "@/lib/llm";

/**
 * Explaining a verdict, and refusing the explanations that would mislead.
 *
 * The judgement itself is computed elsewhere and tested there. What these tests
 * defend is the narrower promise this skill makes: that the prose beside the
 * banner cannot quote a figure nobody measured, cannot comment on a signal that
 * was never evaluated, and cannot describe a history that does not exist.
 */

const HEALTH: SprintHealth = {
  verdict: "critical",
  elapsedFraction: 0.62,
  signals: [
    {
      id: "progress",
      status: "critical",
      metricId: "velocity",
      measured: 0.31,
      threshold: 0.7,
      distance: 0.39,
      missing: null,
    },
    {
      id: "review-wait",
      status: "watch",
      metricId: "review-wait",
      measured: 2.4,
      threshold: 1.5,
      distance: 0.9,
      missing: null,
    },
    {
      id: "wip-limit",
      status: "not-evaluable",
      metricId: "wip",
      measured: null,
      threshold: null,
      distance: null,
      missing: "nessuna colonna dichiara un limite",
    },
  ],
};

function snapshotOf(history: readonly { date: string; verdictLabel: string }[] = []) {
  return buildHealthSnapshot({
    sprintName: "Sprint 4 — Conferma d'ordine",
    health: HEALTH,
    history,
  });
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
          inputTokens: 80,
          outputTokens: 40,
          estimatedCostUsd: 0,
          durationMs: 9,
        });
      },
    },
  };
}

const LONG =
  "Lo sprint mostra un avanzamento molto al di sotto del passo che il calendario suggerirebbe, " +
  "e l'attesa prima della revisione è la fase in cui il lavoro si accumula.";

async function narrate(answer: unknown, snapshot: HealthSnapshot = snapshotOf()) {
  const { gateway } = stubGateway(typeof answer === "string" ? answer : JSON.stringify(answer));

  return narrateSprintHealth({
    gateway,
    snapshot,
    projectName: "Checkout",
    language: "it",
    maxTokens: SPRINT_HEALTH_BUDGET,
  });
}

describe("istantanea della salute", () => {
  it("scrive ogni cifra, con l'unità del proprio segnale", () => {
    const snapshot = snapshotOf();

    const texts = snapshot.values.map((value) => value.text);

    expect(texts).toContain("62%");
    // Una proporzione resta una percentuale…
    expect(texts).toContain("31%");
    // …e un multiplo resta un multiplo: «2,4×» non è «240%» per chi legge.
    expect(texts).toContain("2,4×");
  });

  it("non rende citabile alcuna cifra per un segnale non valutabile", () => {
    const snapshot = snapshotOf();

    const wip = snapshot.signals.find((signal) => signal.id === "wip-limit");

    expect(wip?.measured).toBeNull();
    expect(snapshot.values.some((value) => value.label.startsWith("Limite di lavoro"))).toBe(
      false,
    );
  });

  it("porta il verdetto nelle stesse parole della dashboard", () => {
    expect(snapshotOf().verdictLabel).toBe("Critico");
  });

  it("considera i cinque identificativi dei segnali quelli del motore", () => {
    // Il modello canonico dichiara l'elenco chiuso; il motore lo produce. Se i
    // due divergessero, un'osservazione potrebbe ancorarsi a un segnale che non
    // esiste — e la divergenza non si vedrebbe da nessuna parte.
    for (const signal of HEALTH.signals) {
      expect(healthSignalIdSchema.safeParse(signal.id).success).toBe(true);
    }
  });
});

describe("quando non c'è nulla da spiegare", () => {
  it("un verdetto non valutabile non diventa una narrazione", async () => {
    const snapshot = buildHealthSnapshot({
      sprintName: "Sprint 4",
      health: { ...HEALTH, verdict: "not-evaluable" },
      history: [],
    });

    expect(isNarratable(snapshot)).toBe(false);

    const outcome = await narrate({ situation: LONG, observations: [] }, snapshot);

    expect(outcome.ok).toBe(false);
    // Nessun token speso: non è arrivata a chiedere.
    expect(outcome.ok === false && outcome.usage.provider).toBeNull();
  });
});

describe("la richiesta", () => {
  it("dichiara l'assenza di storia invece di tacerla", () => {
    const prompt = composeHealthPrompt(snapshotOf(), "Checkout");

    expect(prompt).toContain("Non esiste alcun giudizio precedente");
  });

  it("elenca i giudizi precedenti quando ci sono", () => {
    const prompt = composeHealthPrompt(
      snapshotOf([{ date: "12 marzo 2026", verdictLabel: "Sereno" }]),
      "Checkout",
    );

    expect(prompt).toContain("12 marzo 2026: Sereno");
  });

  it("non trasporta alcun testo scritto da terzi", async () => {
    const { gateway, seen } = stubGateway(
      JSON.stringify({ situation: LONG, observations: [] }),
    );

    await narrateSprintHealth({
      gateway,
      snapshot: snapshotOf(),
      projectName: "Checkout",
      language: "it",
      maxTokens: SPRINT_HEALTH_BUDGET,
    });

    // Ogni segnale è un numero calcolato: qui non entrano titoli né commenti,
    // quindi non esiste superficie per un'iniezione indiretta (§8.1).
    expect(seen[0]?.untrustedData).toEqual([]);
  });
});

describe("i rifiuti", () => {
  it("rifiuta una risposta che non è JSON", async () => {
    const outcome = await narrate("Va tutto molto male, credimi.");

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.failureCause).toBe("invalid_output");
  });

  it("rifiuta un numero che nessun segnale ha prodotto", async () => {
    const outcome = await narrate({
      situation: `${LONG} Restano aperti 47 elementi rispetto ai 12 previsti.`,
      observations: [],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("47");
  });

  it("accetta i numeri misurati, scritti come li ha ricevuti", async () => {
    const outcome = await narrate({
      situation: `${LONG} L'avanzamento è al 31% del passo atteso a 62% di sprint trascorso.`,
      observations: [
        {
          signalId: "progress",
          observation: "Il lavoro concluso resta molto indietro rispetto al tempo trascorso.",
        },
      ],
    });

    expect(outcome.ok).toBe(true);
  });

  it("rifiuta un andamento inventato quando non esiste alcun controllo precedente", async () => {
    const outcome = await narrate({
      situation: LONG,
      observations: [],
      trend: "Il giudizio è peggiorato costantemente negli ultimi giorni.",
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("inventato");
  });

  it("accetta l'andamento quando i controlli precedenti esistono", async () => {
    const outcome = await narrate(
      {
        situation: LONG,
        observations: [],
        trend: "Il giudizio era sereno e si è aggravato dopo il primo controllo.",
      },
      snapshotOf([{ date: "12 marzo 2026", verdictLabel: "Sereno" }]),
    );

    expect(outcome.ok).toBe(true);
  });

  it("rifiuta un'osservazione ancorata a un segnale non misurato", async () => {
    const outcome = await narrate({
      situation: LONG,
      observations: [
        {
          signalId: "wip-limit",
          observation: "Il limite di lavoro in corso viene superato con regolarità.",
        },
      ],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toContain("wip-limit");
  });

  it("rifiuta più di quattro osservazioni", async () => {
    const observation = {
      signalId: "progress",
      observation: "Il lavoro concluso resta indietro rispetto al tempo trascorso.",
    };

    const outcome = await narrate({
      situation: LONG,
      observations: [observation, observation, observation, observation, observation],
    });

    expect(outcome.ok).toBe(false);
  });

  it("registra il costo anche quando rifiuta", async () => {
    const outcome = await narrate({
      situation: `${LONG} Restano 99 elementi.`,
      observations: [],
    });

    expect(outcome.ok).toBe(false);
    // Il rifiuto avviene dopo la chiamata: il token è stato speso e va scritto.
    expect(outcome.ok === false && outcome.usage.inputTokens).toBe(80);
  });
});
