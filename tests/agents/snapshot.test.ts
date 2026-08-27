import { describe, expect, it } from "vitest";

import { metricSnapshotSchema, type WorkItemId } from "@/domain";
import { buildSnapshot, hasNarratableContent, type SnapshotInput } from "@/agents/sprint-report";
import { EMPTY_TOTALS, type FlowSummary, type MetricResult } from "@/metrics";
import { DAY, uuidFor } from "../metrics/builders";

/**
 * Whether the translation from `MetricResult` to a report says the truth.
 *
 * The failure this guards against is small and quiet: an unavailable metric
 * rendered as `0`. An empty sprint and a catastrophic one would then read the
 * same, and the sentence a model writes around that zero would be fluent,
 * confident and false.
 */

function available<T>(value: T, sampleSize = 5): MetricResult<T> {
  return { available: true, value, sampleSize };
}

function unavailable<T>(
  reason: "no-data" | "no-qualifying-data" | "empty-denominator" | "mixed-estimate-units",
): MetricResult<T> {
  return { available: false, reason, sampleSize: 0 };
}

const FULL_FLOW: FlowSummary = {
  cycleTime: {
    mean: available(3 * DAY),
    median: available(2.8 * DAY),
    p85: available(8.7 * DAY),
  },
  leadTime: {
    mean: available(9 * DAY),
    median: available(7.9 * DAY),
    p85: available(20 * DAY),
  },
  completedCount: 44,
  consideredCount: 51,
  reopenRate: available(0.114),
  flowEfficiency: {
    mean: available(0.25),
    median: available(0.23),
    p85: available(0.6),
  },
  reviewWait: {
    mean: available(2.6 * DAY),
    median: available(2.5 * DAY),
    p85: available(6 * DAY),
  },
};

const EMPTY_FLOW: FlowSummary = {
  cycleTime: {
    mean: unavailable("no-data"),
    median: unavailable("no-data"),
    p85: unavailable("no-data"),
  },
  leadTime: {
    mean: unavailable("no-data"),
    median: unavailable("no-data"),
    p85: unavailable("no-data"),
  },
  completedCount: 0,
  consideredCount: 0,
  reopenRate: unavailable("empty-denominator"),
  flowEfficiency: {
    mean: unavailable("no-data"),
    median: unavailable("no-data"),
    p85: unavailable("no-data"),
  },
  reviewWait: {
    mean: unavailable("no-data"),
    median: unavailable("no-data"),
    p85: unavailable("no-data"),
  },
};

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    sprintId: "sprint-4",
    sprintName: "Sprint 4 — Conferma d'ordine",
    takenAt: new Date("2026-08-23T06:00:00.000Z"),
    flow: FULL_FLOW,
    velocity: available({
      points: 31,
      hours: null,
      unestimatedCount: 1,
      estimatedCount: 8,
      mixed: false,
    }),
    scopeChange: available({
      added: EMPTY_TOTALS,
      removed: EMPTY_TOTALS,
      addedCount: 3,
      removedCount: 0,
      committedCount: 15,
      plannedAdditions: 1,
      unplannedAdditions: 2,
      undeclaredAdditions: 0,
    }),
    carryOver: available({
      items: [uuidFor("a"), uuidFor("b")] as WorkItemId[],
      estimates: EMPTY_TOTALS,
      consideredCount: 18,
    }),
    throughput: available(44),
    evidence: [],
    evidenceTruncated: false,
    ...overrides,
  };
}

function textOf(snapshot: ReturnType<typeof buildSnapshot>, label: string): string | undefined {
  return snapshot.values.find((value) => value.label === label)?.text;
}

/** One line of a demo agenda, with only the fields the snapshot reads. */
function demoEntry(name: string, treatment: "demo" | "mention") {
  return {
    itemId: uuidFor(name) as WorkItemId,
    title: `Elemento ${name}`,
    kind: "story" as const,
    treatment,
    howToDemo: null,
  };
}

describe("istantanea delle metriche", () => {
  it("rispetta il proprio schema", () => {
    expect(() => metricSnapshotSchema.parse(buildSnapshot(input()))).not.toThrow();
  });

  it("scrive i numeri con le stesse convenzioni della dashboard", () => {
    const snapshot = buildSnapshot(input());

    expect(textOf(snapshot, "Cycle time mediano")).toBe("2,8 giorni");
    expect(textOf(snapshot, "Velocity")).toBe("31 punti");
    expect(textOf(snapshot, "Tasso di riapertura")).toBe("11,4%");
    expect(textOf(snapshot, "Efficienza di flusso mediana")).toBe("23%");
  });

  it("consegna stringhe, mai quantità", () => {
    // Il modello non deve poter arrotondare, scegliere un separatore o
    // dimenticare un'unità: sono tre modi di far litigare report e dashboard.
    for (const value of buildSnapshot(input()).values) {
      expect(typeof value.text).toBe("string");
    }
  });

  it("dichiara una lacuna invece di scrivere zero", () => {
    const snapshot = buildSnapshot(input({ flow: EMPTY_FLOW }));

    expect(textOf(snapshot, "Cycle time mediano")).toBeUndefined();

    const gap = snapshot.gaps.find((entry) => entry.metricId === "cycle-time");
    expect(gap?.reason).toBe("no-data");
    expect(gap?.explanation).toContain("non ci sono dati");
  });

  it("non somma mai stime in unità diverse", () => {
    const snapshot = buildSnapshot(
      input({
        velocity: available(
          {
            points: 12,
            hours: 30,
            unestimatedCount: 0,
            estimatedCount: 6,
            mixed: true,
          },
          6,
        ),
      }),
    );

    expect(textOf(snapshot, "Velocity")).toBeUndefined();
    expect(snapshot.gaps.find((entry) => entry.metricId === "velocity")?.reason).toBe(
      "mixed-estimate-units",
    );
  });

  it("con unità miste perde la somma ma non il conteggio", () => {
    // Quante cose sono state chiuse resta vero anche quando le stime non si
    // possono sommare: le unità diverse rendono priva di senso la somma, non
    // il conteggio.
    const snapshot = buildSnapshot(
      input({
        velocity: available(
          { points: 12, hours: 30, unestimatedCount: 0, estimatedCount: 6, mixed: true },
          6,
        ),
      }),
    );

    expect(textOf(snapshot, "Elementi conclusi nello sprint")).toBe("6 elementi");
  });

  it("distingue «nessuna stima» da «velocity zero»", () => {
    const senzaStime = buildSnapshot(
      input({
        velocity: available({
          points: null,
          hours: null,
          unestimatedCount: 9,
          estimatedCount: 0,
          mixed: false,
        }),
      }),
    );

    expect(textOf(senzaStime, "Velocity")).toBeUndefined();
    expect(senzaStime.gaps.some((entry) => entry.metricId === "velocity")).toBe(true);

    // Zero punti stimati è un fatto misurato, non una lacuna: va detto.
    const veroZero = buildSnapshot(
      input({
        velocity: available({
          points: 0,
          hours: null,
          unestimatedCount: 0,
          estimatedCount: 4,
          mixed: false,
        }),
      }),
    );

    expect(textOf(veroZero, "Velocity")).toBe("0 punti");
    expect(veroZero.gaps.some((entry) => entry.metricId === "velocity")).toBe(false);
  });

  it("riporta le stime in ore quando il team stima in ore", () => {
    const snapshot = buildSnapshot(
      input({
        velocity: available({
          points: null,
          hours: 30,
          unestimatedCount: 0,
          estimatedCount: 6,
          mixed: false,
        }),
      }),
    );

    expect(textOf(snapshot, "Velocity")).toBe("30 ore");
  });

  it("ogni valore e ogni lacuna nomina una metrica del catalogo", () => {
    const snapshot = buildSnapshot(input({ flow: EMPTY_FLOW }));

    for (const entry of [...snapshot.values, ...snapshot.gaps]) {
      expect(entry.metricId).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("una metrica non compare contemporaneamente fra i valori e fra le lacune", () => {
    const snapshot = buildSnapshot(input());

    for (const gap of snapshot.gaps) {
      const alsoAValue = snapshot.values.some(
        (value) => value.metricId === gap.metricId && value.label === gap.label,
      );
      expect(alsoAValue, `${gap.label} è sia valore sia lacuna`).toBe(false);
    }
  });

  it("senza alcun valore dichiara che non c'è nulla da raccontare", () => {
    const snapshot = buildSnapshot(
      input({
        flow: EMPTY_FLOW,
        velocity: unavailable("no-data"),
        scopeChange: unavailable("no-data"),
        carryOver: unavailable("no-data"),
        throughput: unavailable("empty-denominator"),
      }),
    );

    expect(snapshot.values).toEqual([]);
    expect(hasNarratableContent(snapshot)).toBe(false);
    expect(snapshot.gaps.length).toBeGreaterThan(0);
  });

  it("con almeno un valore c'è qualcosa da raccontare", () => {
    expect(hasNarratableContent(buildSnapshot(input()))).toBe(true);
  });
});

describe("istantanea — i numeri che il libro chiede a fine sprint", () => {
  it("dice quanti degli elementi aggiunti erano interruzioni", () => {
    // > «We've had three **unplanned items**, as you can see down to the right.
    // > This is useful to remember when you do the sprint retrospective.» (pag. 60)
    const snapshot = buildSnapshot(input());

    expect(textOf(snapshot, "Di cui non pianificati")).toBe("2 elementi");
  });

  it("tace sugli elementi non pianificati quando nessuno li ha dichiarati", () => {
    /*
     * Il caso che conta, perché sarà quasi sempre questo: né Jira né Azure
     * DevOps distinguono un'aggiunta voluta da un'interruzione (ADR-0009).
     * Scrivere «0 non pianificati» direbbe che lo sprint non ha subito
     * interruzioni — un'affermazione su una settimana di lavoro che nessuno ha
     * registrato.
     */
    const snapshot = buildSnapshot(
      input({
        scopeChange: available({
          added: EMPTY_TOTALS,
          removed: EMPTY_TOTALS,
          addedCount: 3,
          removedCount: 0,
          committedCount: 15,
          plannedAdditions: 0,
          unplannedAdditions: 0,
          undeclaredAdditions: 3,
        }),
      }),
    );

    expect(textOf(snapshot, "Di cui non pianificati")).toBeUndefined();
    expect(textOf(snapshot, "Lavoro aggiunto dopo l'inizio")).toBe("3 elementi");
  });

  it("mette il verso nell'etichetta invece che nel segno del numero", () => {
    /*
     * La verifica di fedeltà tratta il segno come parte della cifra. Un valore
     * citabile «-13» farebbe rifiutare un rapporto che scrive «tredici punti in
     * meno», che è corretto: una verifica di verità non deve dipendere da una
     * convenzione tipografica.
     */
    const snapshot = buildSnapshot(input({ forecastVariance: available(-13) }));

    expect(textOf(snapshot, "Punti in meno rispetto alla previsione")).toBe("13 punti");
  });

  it("dichiara di più quando lo sprint ha superato la previsione", () => {
    const snapshot = buildSnapshot(input({ forecastVariance: available(4) }));

    expect(textOf(snapshot, "Punti in più rispetto alla previsione")).toBe("4 punti");
  });

  it("non parla di previsione se nessuno ne aveva registrata una", () => {
    // Assente non è zero: zero direbbe «siamo atterrati esattamente sul piano»,
    // che è l'opposto di «non c'era un piano su cui atterrare».
    const snapshot = buildSnapshot(input());

    expect(snapshot.values.some((value) => value.metricId === "forecast-variance")).toBe(false);
    expect(snapshot.gaps.some((entry) => entry.metricId === "forecast-variance")).toBe(false);
  });

  it("riporta la scaletta della demo divisa in due", () => {
    const snapshot = buildSnapshot({
      ...input(),
      demo: {
        goal: "Chiudere il checkout",
        toDemo: [demoEntry("a", "demo"), demoEntry("b", "demo")],
        toMention: [demoEntry("c", "mention")],
        withoutHowToDemo: [],
      },
    });

    expect(textOf(snapshot, "Elementi da mostrare alla demo")).toBe("2 elementi");
    expect(textOf(snapshot, "Elementi da nominare soltanto")).toBe("1 elementi");
  });

  it("non aggiunge una riga vuota quando non c'è nulla da nominare", () => {
    const snapshot = buildSnapshot({
      ...input(),
      demo: {
        goal: null,
        toDemo: [demoEntry("a", "demo")],
        toMention: [],
        withoutHowToDemo: [],
      },
    });

    expect(textOf(snapshot, "Elementi da nominare soltanto")).toBeUndefined();
  });
});
