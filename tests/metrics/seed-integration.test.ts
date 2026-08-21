import { describe, expect, it } from "vitest";

import { generateSeedBatch } from "@/connectors/seed";
import { organizationIdSchema, projectIdSchema } from "@/domain";
import {
  carryOver,
  flowEfficiency,
  reviewWaitTime,
  scopeChange,
  summariseFlow,
  velocity,
  type MetricResult,
} from "@/metrics";

/**
 * The metrics engine against the synthetic data set.
 *
 * The seed connector was built with deliberate defects: scope growing
 * mid-sprint, review congealing, work dragging forward. This file asks the
 * question that closes the loop — **does the engine actually see them?**
 *
 * Two independent implementations agreeing is worth far more than either one
 * agreeing with itself. If the generator says sprint 3 has a review bottleneck
 * and the metrics do not report one, at least one of them is wrong, and neither
 * unit-test suite would have noticed.
 *
 * No database and no network: the connector generates in memory and the metrics
 * are pure, so this runs in milliseconds on every push.
 */

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

const batch = generateSeedBatch({
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
});

const sprints = [...batch.sprints].sort(
  (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
);

/** The instant everything is measured at: just after the last sprint ends. */
const ASOF = new Date(sprints[sprints.length - 1]!.endsAt.getTime() + 24 * 60 * 60 * 1000);

function itemsOf(sprintIndex: number) {
  const sprint = sprints[sprintIndex]!;
  return batch.workItems.filter((item) => item.sprintId === sprint.id);
}

function valueOf<T>(result: MetricResult<T>, label: string): T {
  if (!result.available) throw new Error(`${label} non disponibile: ${result.reason}`);
  return result.value;
}

describe("le metriche leggono i dati sintetici", () => {
  it("calcola una velocity per ogni sprint concluso", () => {
    for (const [index, sprint] of sprints.entries()) {
      const result = velocity(sprint, batch.workItems, batch.transitions, batch.scopeEvents);

      expect(result.available, `sprint ${index + 1}`).toBe(true);
      if (result.available) {
        // Il connettore stima solo in punti: un risultato misto qui
        // segnalerebbe un difetto del generatore, non della metrica.
        expect(result.value.mixed, `sprint ${index + 1} con unità miste`).toBe(false);
      }
    }
  });

  it("nessuna metrica produce NaN sui dati reali", () => {
    for (const sprint of sprints) {
      const v = velocity(sprint, batch.workItems, batch.transitions, batch.scopeEvents);
      if (v.available && v.value.points !== null) {
        expect(Number.isFinite(v.value.points)).toBe(true);
      }
    }

    const flow = summariseFlow(batch.workItems, batch.transitions, ASOF);
    for (const result of [flow.cycleTime.mean, flow.cycleTime.median, flow.cycleTime.p85]) {
      if (result.available) expect(Number.isFinite(result.value)).toBe(true);
    }
  });
});

describe("le anomalie volute sono visibili nelle metriche", () => {
  it("lo sprint 2 mostra lavoro aggiunto dopo l'inizio", () => {
    const result = scopeChange(sprints[1]!, batch.workItems, batch.scopeEvents);
    const change = valueOf(result, "scopeChange sprint 2");

    expect(change.addedCount).toBeGreaterThan(0);
  });

  it("il primo sprint non ha aggiunte a metà: è il riferimento sano", () => {
    const change = valueOf(
      scopeChange(sprints[0]!, batch.workItems, batch.scopeEvents),
      "scopeChange sprint 1",
    );

    expect(change.addedCount).toBe(0);
    expect(change.committedCount).toBeGreaterThan(0);
  });

  it("l'attesa in revisione peggiora dal primo all'ultimo sprint", () => {
    // Il collo di bottiglia costruito negli sprint 3 e 4 deve emergere qui.
    const averageReviewWait = (sprintIndex: number): number => {
      const items = itemsOf(sprintIndex);
      const waits: number[] = [];

      for (const item of items) {
        const history = batch.transitions.filter((t) => t.workItemId === item.id);
        const result = reviewWaitTime(history, ASOF);
        if (result.available) waits.push(result.value);
      }

      return waits.length === 0 ? 0 : waits.reduce((a, b) => a + b, 0) / waits.length;
    };

    expect(averageReviewWait(3)).toBeGreaterThan(averageReviewWait(0));
  });

  it("il lavoro trascinato cresce nel corso dei quattro sprint", () => {
    const carriedIn = (sprintIndex: number): number =>
      valueOf(
        carryOver(sprints[sprintIndex]!, batch.workItems, batch.transitions, batch.scopeEvents),
        `carryOver sprint ${sprintIndex + 1}`,
      ).items.length;

    expect(carriedIn(3)).toBeGreaterThan(carriedIn(0));
  });

  it("esistono elementi riaperti, quindi il tasso di riapertura non è nullo", () => {
    const flow = summariseFlow(batch.workItems, batch.transitions, ASOF);

    expect(flow.reopenRate.available).toBe(true);
    if (flow.reopenRate.available) expect(flow.reopenRate.value).toBeGreaterThan(0);
  });

  it("l'efficienza di flusso vede l'attesa in revisione, non solo i blocchi", () => {
    // Questo test è il rovescio di quello che stava qui prima, il quale
    // documentava un limite: con `in_review` contato come lavoro, la mediana
    // era esattamente 1 mentre l'attesa in revisione cresceva da ore a giorni.
    //
    // Risolta la questione Q1, la metrica deve scendere sotto 1: nel software
    // l'efficienza di flusso misurata sta tipicamente fra il 5% e il 15%, e un
    // numero che non può scendere non è una misura ma una costante travestita.
    const flow = summariseFlow(batch.workItems, batch.transitions, ASOF);
    const median = flow.flowEfficiency.median;

    expect(median.available).toBe(true);
    if (median.available) {
      expect(median.value).toBeGreaterThan(0);
      expect(median.value).toBeLessThan(1);
    }

    // Gli elementi che si sono bloccati devono comunque scendere sotto 1,
    // altrimenti la metrica non misurerebbe nulla del tutto.
    const blockedItems = batch.workItems.filter((item) =>
      batch.transitions.some((t) => t.workItemId === item.id && t.toState === "blocked"),
    );
    expect(blockedItems.length, "i dati sintetici devono contenere blocchi").toBeGreaterThan(0);

    const efficiencies = blockedItems
      .map((item) =>
        flowEfficiency(
          batch.transitions.filter((t) => t.workItemId === item.id),
          ASOF,
        ),
      )
      .filter((result) => result.available)
      .map((result) => (result.available ? result.value : 1));

    expect(Math.min(...efficiencies)).toBeLessThan(1);
  });

  it("l'efficienza peggiora negli sprint in cui la revisione si ingolfa", () => {
    // Il legame che prima non esisteva: se l'attesa in revisione cresce di
    // sprint in sprint, l'efficienza deve calare. Sono due letture dello stesso
    // fenomeno, e devono concordare.
    const efficiencyIn = (sprintIndex: number): number[] =>
      itemsOf(sprintIndex)
        .map((item) =>
          flowEfficiency(
            batch.transitions.filter((t) => t.workItemId === item.id),
            ASOF,
          ),
        )
        .filter((result) => result.available)
        .map((result) => (result.available ? result.value : 1));

    const mean = (values: number[]): number =>
      values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

    expect(mean(efficiencyIn(3))).toBeLessThan(mean(efficiencyIn(0)));
  });

  it("il collo di bottiglia in revisione si legge in reviewWaitTime, non nell'efficienza", () => {
    // Contropartita del test precedente: la metrica che *vede* il problema.
    const waitsIn = (sprintIndex: number): number[] =>
      itemsOf(sprintIndex)
        .map((item) =>
          reviewWaitTime(
            batch.transitions.filter((t) => t.workItemId === item.id),
            ASOF,
          ),
        )
        .filter((result) => result.available)
        .map((result) => (result.available ? result.value : 0));

    const early = waitsIn(0);
    const late = waitsIn(3);

    const mean = (values: number[]): number =>
      values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

    expect(mean(late)).toBeGreaterThan(mean(early));
  });
});

describe("coerenza fra metriche indipendenti", () => {
  it("gli elementi conclusi contati dal flusso non superano quelli esistenti", () => {
    const flow = summariseFlow(batch.workItems, batch.transitions, ASOF);

    expect(flow.completedCount).toBeLessThanOrEqual(flow.consideredCount);
    expect(flow.consideredCount).toBe(batch.workItems.length);
  });

  it("il lavoro trascinato di uno sprint non supera i suoi elementi", () => {
    for (const [index, sprint] of sprints.entries()) {
      const carried = valueOf(
        carryOver(sprint, batch.workItems, batch.transitions, batch.scopeEvents),
        `carryOver sprint ${index + 1}`,
      );

      expect(carried.items.length).toBeLessThanOrEqual(carried.consideredCount);
    }
  });

  it("la mediana del cycle time non supera l'85° percentile", () => {
    // Una violazione qui rivelerebbe un errore nel calcolo dei percentili,
    // che nessun test su valori inventati intercetterebbe.
    const flow = summariseFlow(batch.workItems, batch.transitions, ASOF);
    const { median, p85 } = flow.cycleTime;

    if (median.available && p85.available) {
      expect(p85.value).toBeGreaterThanOrEqual(median.value);
    }
  });
});
