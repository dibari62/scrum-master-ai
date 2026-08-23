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
        velocity: available({
          points: 12,
          hours: 30,
          unestimatedCount: 0,
          estimatedCount: 6,
          mixed: true,
        }),
      }),
    );

    expect(textOf(snapshot, "Velocity")).toBeUndefined();
    expect(snapshot.gaps.find((entry) => entry.metricId === "velocity")?.reason).toBe(
      "mixed-estimate-units",
    );
  });

  it("distingue «nessuna stima» da «velocity zero»", () => {
    const snapshot = buildSnapshot(
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

    expect(textOf(snapshot, "Velocity")).toBeUndefined();
    expect(snapshot.gaps.some((entry) => entry.metricId === "velocity")).toBe(true);
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
