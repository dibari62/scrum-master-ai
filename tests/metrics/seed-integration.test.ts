import { describe, expect, it } from "vitest";

import { generateSeedBatch } from "@/connectors/seed";
import { organizationIdSchema, projectIdSchema } from "@/domain";
import {
  bottleneck,
  carryOver,
  flowEfficiency,
  reviewWaitTime,
  scopeChange,
  sprintHealth,
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

/**
 * The instant the data set is generated at, and the instant it is measured at.
 *
 * **They have to be the same one.** The scenario places its sprints backwards
 * from this instant so the last one is still running, and it emits nothing
 * dated after it. Measuring at any later moment would ask the engine about a
 * stretch of time the generator deliberately left empty, and every figure would
 * quietly describe a project that had stopped.
 *
 * Fixed rather than `new Date()`, or these assertions would be made against a
 * different data set every day.
 */
const ASOF = new Date("2026-08-19T10:00:00.000Z");

const batch = generateSeedBatch({
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  asOf: ASOF,
});

const sprints = [...batch.sprints].sort(
  (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
);

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

/**
 * Il giudizio sullo sprint in corso, sui dati sintetici.
 *
 * **È il test che dimostra che la funzione serve a qualcosa.** I test unitari
 * di `health.test.ts` provano che l'aritmetica è giusta su casi costruiti a
 * tavolino, ma un motore può essere perfettamente corretto e non accendersi mai
 * su dati veri — e sarebbe indistinguibile, dall'esterno, da una squadra che va
 * bene.
 *
 * Lo scenario peggiora di proposito sprint dopo sprint: la revisione si
 * ingolfa, il perimetro cresce, il trascinato aumenta. Se il semaforo restasse
 * sereno su questi dati, sarebbe decorazione.
 */
describe("la salute dello sprint legge i dati sintetici", () => {
  const current = sprints.at(-1);
  const closed = sprints.filter((sprint) => sprint.completedAt !== null);

  const columns = batch.boardColumns;

  it("lo scenario offre davvero uno sprint in corso da giudicare", () => {
    // Il prerequisito della questione Q5. Se cade questo, tutto il resto di
    // questo blocco sta misurando il vuoto.
    if (!current) throw new Error("atteso almeno uno sprint");

    expect(current.completedAt).toBeNull();
    expect(current.startsAt.getTime()).toBeLessThanOrEqual(ASOF.getTime());
    expect(current.endsAt.getTime()).toBeGreaterThanOrEqual(ASOF.getTime());
  });

  it("produce un giudizio, invece di dichiararsi incapace", () => {
    if (!current) throw new Error("atteso almeno uno sprint");

    const result = sprintHealth({
      sprint: current,
      items: batch.workItems,
      transitions: batch.transitions,
      scopeEvents: batch.scopeEvents,
      closedSprints: closed,
      columns,
      asOf: ASOF,
    });

    const health = valueOf(result, "sprintHealth");
    expect(health.verdict).not.toBe("not-evaluable");
  });

  it("si accorge che qualcosa non va: il verdetto non è sereno", () => {
    /*
     * Il cuore del test.
     *
     * Questi dati raccontano una squadra in difficoltà crescente. Un semaforo
     * verde qui significherebbe che le soglie sono tarate per non accendersi
     * mai, che è il modo più comune in cui un indicatore smette di servire.
     */
    if (!current) throw new Error("atteso almeno uno sprint");

    const health = valueOf(
      sprintHealth({
        sprint: current,
        items: batch.workItems,
        transitions: batch.transitions,
        scopeEvents: batch.scopeEvents,
        closedSprints: closed,
        columns,
        asOf: ASOF,
      }),
      "sprintHealth",
    );

    expect(health.verdict, "il semaforo resta sereno su dati che peggiorano").not.toBe(
      "respected",
    );
  });

  it("il collo di bottiglia in revisione arriva fino al semaforo", () => {
    // La catena completa: il generatore lo inserisce, `reviewWaitTime` lo
    // misura, e il segnale lo trasforma in qualcosa che si vede senza cercarlo.
    if (!current) throw new Error("atteso almeno uno sprint");

    const health = valueOf(
      sprintHealth({
        sprint: current,
        items: batch.workItems,
        transitions: batch.transitions,
        scopeEvents: batch.scopeEvents,
        closedSprints: closed,
        columns,
        asOf: ASOF,
      }),
      "sprintHealth",
    );

    const reviewWait = health.signals.find((signal) => signal.id === "review-wait");
    expect(reviewWait?.status).not.toBe("respected");
  });

  it("ogni rilievo dichiara metrica, valore, soglia e scarto", () => {
    // Criterio 3 della specifica, verificato sui dati veri e non solo sui casi
    // costruiti: un rilievo senza scarto è un'affermazione che non si può
    // discutere.
    if (!current) throw new Error("atteso almeno uno sprint");

    const health = valueOf(
      sprintHealth({
        sprint: current,
        items: batch.workItems,
        transitions: batch.transitions,
        scopeEvents: batch.scopeEvents,
        closedSprints: closed,
        columns,
        asOf: ASOF,
      }),
      "sprintHealth",
    );

    for (const signal of health.signals) {
      expect(signal.metricId.length, `${signal.id} senza metrica`).toBeGreaterThan(0);

      if (signal.status === "not-evaluable") {
        // Ciò che manca va detto, non lasciato indovinare.
        expect(signal.missing, `${signal.id} non dice cosa manca`).toBeTruthy();
        continue;
      }

      expect(signal.measured, `${signal.id} senza valore misurato`).not.toBeNull();
      expect(signal.threshold, `${signal.id} senza soglia`).not.toBeNull();

      if (signal.status !== "respected") {
        expect(signal.distance, `${signal.id} senza scarto dalla soglia`).not.toBeNull();
      }
    }
  });
});

/**
 * Il collo di bottiglia, sui dati sintetici.
 *
 * **È il test che dimostra che la metrica serve.** Lo scenario ingolfa la
 * revisione di proposito, portando l'attesa da poche ore a giorni. Se la
 * ripartizione del tempo non lo facesse emergere, la metrica sarebbe corretta e
 * inutile — e dall'esterno le due cose si somigliano molto.
 */
describe("il collo di bottiglia legge i dati sintetici", () => {
  const result = bottleneck(batch.transitions, ASOF);

  it("individua la revisione come fase che assorbe più attesa", () => {
    const found = valueOf(result, "bottleneck");

    expect(found.worstWait?.state).toBe("in_review");
    expect(found.worstWait?.valueAdding).toBe(false);
  });

  it("le quote sommano a uno anche su dati veri", () => {
    // Su dati costruiti a mano è facile; qui passano centinaia di tratti, ed è
    // dove un errore di somma comparirebbe.
    const found = valueOf(result, "bottleneck");
    const sum = found.stages.reduce((total, stage) => total + stage.share, 0);

    expect(sum).toBeCloseTo(1, 10);
  });

  it("concorda con l'efficienza di flusso invece di contraddirla", () => {
    /*
     * Due strade indipendenti verso lo stesso fatto.
     *
     * L'efficienza di flusso misura per elemento e poi riassume; questa somma
     * il tempo per fase su tutti gli elementi. Non devono dare lo stesso
     * numero — sono aggregazioni diverse — ma devono raccontare la stessa
     * storia: la maggior parte del tempo non è lavorazione.
     */
    const found = valueOf(result, "bottleneck");
    const flow = summariseFlow(batch.workItems, batch.transitions, ASOF);

    expect(found.valueAddingShare).toBeLessThan(0.5);

    if (flow.flowEfficiency.median.available) {
      expect(flow.flowEfficiency.median.value).toBeLessThan(0.5);
    }
  });

  it("non chiama collo di bottiglia una fase in cui si lavora", () => {
    const found = valueOf(result, "bottleneck");

    for (const stage of found.stages) {
      if (stage.state === found.worstWait?.state) {
        expect(stage.valueAdding).toBe(false);
      }
    }
  });
});
