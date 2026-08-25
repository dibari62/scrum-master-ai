import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WORKING_CALENDAR,
  sprintSchema,
  sprintScopeEventSchema,
  type Sprint,
  type SprintScopeEvent,
} from "@/domain";
import {
  burndown,
  carryOver,
  membershipAt,
  scopeChange,
  sprintItemCount,
  throughput,
  totalEstimates,
  velocity,
  workInProgress,
  workItemsByState,
} from "@/metrics";

import { DAY, estimateChange, item, move, resetIds } from "./builders";

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";
const SPRINT_ID = "2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35";
/** A second sprint, to check that one sprint's events never count for another. */
const OTHER_SPRINT_ID = "6b1f9d02-4a83-4e57-b16c-9f2d7e40a8c1";

const ITEM_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ITEM_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ITEM_C = "cccccccc-0000-4000-8000-000000000003";

const SCOPE = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  sourceSystem: "seed",
} as const;

beforeEach(() => resetIds());

function sprint(overrides: Partial<{ startsAt: string; endsAt: string; completedAt: string | null }> = {}): Sprint {
  return sprintSchema.parse({
    id: SPRINT_ID,
    ...SCOPE,
    sourceId: "sprint-1",
    name: "Sprint di prova",
    goal: null,
    startsAt: overrides.startsAt ?? "2026-04-06T08:00:00.000Z",
    endsAt: overrides.endsAt ?? "2026-04-17T18:00:00.000Z",
    completedAt: overrides.completedAt === undefined ? null : overrides.completedAt,
    createdAt: "2026-04-06T08:00:00.000Z",
    updatedAt: "2026-04-06T08:00:00.000Z",
  });
}

let eventCounter = 0;

function scopeEvent(
  workItemId: string,
  kind: "added" | "removed",
  occurredAt: string,
  sprintId = SPRINT_ID,
): SprintScopeEvent {
  eventCounter += 1;
  return sprintScopeEventSchema.parse({
    ...SCOPE,
    sourceId: `scope-${eventCounter}`,
    sprintId,
    workItemId,
    kind,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

describe("totalEstimates", () => {
  it("tiene separate le unità invece di sommarle", () => {
    // La regola più severa del modulo: 8 punti + 5 ore non fa 13.
    const totals = totalEstimates([
      item({ id: ITEM_A, estimate: { value: 8, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 5, unit: "hours" } }),
    ]);

    expect(totals.points).toBe(8);
    expect(totals.hours).toBe(5);
    expect(totals.mixed).toBe(true);
  });

  it("segnala l'unità assente con null, non con zero", () => {
    const totals = totalEstimates([item({ id: ITEM_A, estimate: { value: 3, unit: "points" } })]);

    expect(totals.points).toBe(3);
    expect(totals.hours).toBeNull();
    expect(totals.mixed).toBe(false);
  });

  it("distingue elementi non stimati da elementi stimati a zero", () => {
    // Dieci elementi non stimati non hanno totale; dieci stimati a zero hanno
    // totale zero. Confonderli nasconderebbe una squadra che ha smesso di stimare.
    const unestimated = totalEstimates([item({ id: ITEM_A, estimate: null })]);
    expect(unestimated.points).toBeNull();
    expect(unestimated.unestimatedCount).toBe(1);

    const zero = totalEstimates([item({ id: ITEM_A, estimate: { value: 0, unit: "points" } })]);
    expect(zero.points).toBe(0);
    expect(zero.unestimatedCount).toBe(0);
  });

  it("su un insieme vuoto non produce zeri finti", () => {
    const totals = totalEstimates([]);
    expect(totals.points).toBeNull();
    expect(totals.hours).toBeNull();
    expect(totals.estimatedCount).toBe(0);
  });
});

describe("membershipAt", () => {
  const events = [
    scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
    scopeEvent(ITEM_B, "added", "2026-04-10T09:00:00.000Z"),
    scopeEvent(ITEM_A, "removed", "2026-04-12T09:00:00.000Z"),
  ];

  it("ricostruisce l'appartenenza a un istante passato", () => {
    const atStart = membershipAt(events, sprint(), new Date("2026-04-06T08:00:00.000Z"));
    expect([...atStart]).toEqual([ITEM_A]);

    const midway = membershipAt(events, sprint(), new Date("2026-04-11T00:00:00.000Z"));
    expect([...midway].sort()).toEqual([ITEM_A, ITEM_B].sort());

    const atEnd = membershipAt(events, sprint(), new Date("2026-04-17T18:00:00.000Z"));
    expect([...atEnd]).toEqual([ITEM_B]);
  });

  it("ignora gli eventi di altri sprint", () => {
    const other = scopeEvent(ITEM_C, "added", "2026-04-06T08:00:00.000Z", "99999999-0000-4000-8000-000000000009");
    const members = membershipAt([...events, other], sprint(), new Date("2026-04-06T08:00:00.000Z"));

    expect(members.has(ITEM_C as never)).toBe(false);
  });

  it("è vuota prima che qualsiasi elemento entrasse", () => {
    expect(membershipAt(events, sprint(), new Date("2026-04-01T00:00:00.000Z")).size).toBe(0);
  });
});

describe("velocity", () => {
  const events = [
    scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
    scopeEvent(ITEM_B, "added", "2026-04-06T08:00:00.000Z"),
  ];

  const items = [
    item({ id: ITEM_A, estimate: { value: 5, unit: "points" } }),
    item({ id: ITEM_B, estimate: { value: 3, unit: "points" } }),
  ];

  it("somma le stime del lavoro concluso entro la chiusura", () => {
    const transitions = [
      move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = velocity(sprint(), items, transitions, events);
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.points).toBe(5);
    expect(result.sampleSize).toBe(1);
  });

  it("esclude un elemento riaperto prima della chiusura", () => {
    // Concluso e poi riaperto: alla chiusura non era fatto, e contarlo
    // accrediterebbe alla squadra lavoro che le resta da fare.
    const transitions = [
      move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move("done", "in_progress", "2026-04-15T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = velocity(sprint(), items, transitions, events);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBeNull();
  });

  it("non è disponibile se lo sprint non contiene nulla", () => {
    expect(velocity(sprint(), [], [], []).available).toBe(false);
  });

  it("ignora una ri-stima fatta durante lo sprint", () => {
    /*
     * La regola più netta del libro sulla velocity: «the actual velocity is
     * based on the *initial* estimates of each story. Any updates to the story
     * time estimates done during the sprint are ignored» (pag. 29).
     *
     * Senza questa regola il numero non è solo impreciso, è **instabile**:
     * correggere oggi la stima di una storia sposterebbe la velocity di uno
     * sprint chiuso settimane fa, e chi la rilegge la vede cambiare sotto gli
     * occhi. È lo stesso motivo per cui ADR-0003 non legge lo stato corrente.
     */
    const transitions = [
      move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    // Oggi l'elemento è stimato 13, ma quando è entrato nello sprint era 5.
    const reEstimated = [item({ id: ITEM_A, estimate: { value: 13, unit: "points" } })];
    const changes = [
      estimateChange(ITEM_A, null, { value: 5, unit: "points" }, "2026-04-02T08:00:00.000Z"),
      estimateChange(
        ITEM_A,
        { value: 5, unit: "points" },
        { value: 13, unit: "points" },
        "2026-04-14T10:00:00.000Z",
      ),
    ];

    const result = velocity(
      sprint(),
      reEstimated,
      transitions,
      [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")],
      changes,
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBe(5);
  });

  it("usa la stima all'ingresso per un elemento aggiunto a metà sprint", () => {
    /*
     * «Iniziale» non significa «alla creazione» né «all'inizio dello sprint»:
     * significa all'ingresso in *questo* sprint. Un elemento tirato dentro il
     * decimo giorno ha portato nel piano la taglia che aveva quel giorno, e
     * nulla di precedente era mai stato promesso.
     */
    const transitions = [
      move(null, "todo", "2026-04-02T08:00:00.000Z", { workItemId: ITEM_C }),
      move("todo", "done", "2026-04-16T09:00:00.000Z", { workItemId: ITEM_C }),
    ];

    const changes = [
      estimateChange(ITEM_C, null, { value: 2, unit: "points" }, "2026-04-02T08:00:00.000Z"),
      // Ri-stimato *prima* di entrare: è questa la stima che entra nel piano.
      estimateChange(
        ITEM_C,
        { value: 2, unit: "points" },
        { value: 8, unit: "points" },
        "2026-04-13T09:00:00.000Z",
      ),
      // E ri-stimato di nuovo dopo l'ingresso: questa va ignorata.
      estimateChange(
        ITEM_C,
        { value: 8, unit: "points" },
        { value: 20, unit: "points" },
        "2026-04-16T08:00:00.000Z",
      ),
    ];

    const result = velocity(
      sprint(),
      [item({ id: ITEM_C, estimate: { value: 20, unit: "points" } })],
      transitions,
      [scopeEvent(ITEM_C, "added", "2026-04-14T09:00:00.000Z")],
      changes,
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBe(8);
  });

  it("ricade sulla stima corrente quando la fonte non espone la storia", () => {
    /*
     * Comportamento dichiarato, non svista: una fonte che espone solo il valore
     * corrente ci dà una sola osservazione, e leggerla come «è sempre stato
     * così» è l'unica lettura disponibile. Ciò che non può fare è nascondere
     * una ri-stima, perché una ri-stima che la fonte non ha mai registrato non
     * è conoscibile da nessun calcolo.
     */
    const transitions = [
      move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = velocity(sprint(), items, transitions, events, []);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBe(5);
  });

  it("dichiara il risultato parziale quando le unità si mescolano", () => {
    const mixedItems = [
      item({ id: ITEM_A, estimate: { value: 5, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 4, unit: "hours" } }),
    ];
    const transitions = [
      move(null, "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = velocity(sprint(), mixedItems, transitions, events);
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.mixed).toBe(true);
    expect(result.value.points).toBe(5);
    expect(result.value.hours).toBe(4);
  });
});

describe("scopeChange", () => {
  it("non considera variazione ciò che c'era all'inizio", () => {
    // Contare la dotazione iniziale come aggiunta segnalerebbe ogni sprint
    // come rifatto al cento per cento.
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const result = scopeChange(sprint(), [item({ id: ITEM_A })], events);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.addedCount).toBe(0);
    expect(result.value.committedCount).toBe(1);
  });

  it("conta il lavoro aggiunto a sprint iniziato", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-10T09:00:00.000Z"),
    ];
    const items = [
      item({ id: ITEM_A, estimate: { value: 5, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 8, unit: "points" } }),
    ];

    const result = scopeChange(sprint(), items, events);
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.addedCount).toBe(1);
    expect(result.value.added.points).toBe(8);
  });

  it("conta il lavoro rimosso a sprint iniziato", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_A, "removed", "2026-04-12T09:00:00.000Z"),
    ];

    const result = scopeChange(sprint(), [item({ id: ITEM_A })], events);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.removedCount).toBe(1);
  });

  it("non è disponibile senza eventi di perimetro", () => {
    expect(scopeChange(sprint(), [], []).available).toBe(false);
  });
});

describe("carryOver", () => {
  const events = [
    scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
    scopeEvent(ITEM_B, "added", "2026-04-06T08:00:00.000Z"),
  ];
  const items = [
    item({ id: ITEM_A, estimate: { value: 5, unit: "points" } }),
    item({ id: ITEM_B, estimate: { value: 3, unit: "points" } }),
  ];

  it("elenca il lavoro non concluso alla chiusura", () => {
    const transitions = [
      move(null, "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "in_review", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = carryOver(sprint(), items, transitions, events);
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.items).toEqual([ITEM_B]);
    expect(result.value.estimates.points).toBe(3);
    expect(result.value.consideredCount).toBe(2);
  });

  it("non conta come trascinato ciò che è stato annullato", () => {
    // Annullare non è "non essere riusciti a finire".
    const transitions = [
      move(null, "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "cancelled", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = carryOver(sprint(), items, transitions, events);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.items).toEqual([]);
  });

  it("usa la chiusura effettiva quando lo sprint è stato chiuso in ritardo", () => {
    const closedLate = sprint({ completedAt: "2026-04-19T18:00:00.000Z" });
    const transitions = [
      move(null, "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      // Concluso dopo la data prevista ma prima della chiusura effettiva.
      move(null, "done", "2026-04-18T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = carryOver(closedLate, items, transitions, events);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.items).toEqual([]);
  });
});

describe("burndown", () => {
  /**
   * An instant past the end of the sprint.
   *
   * Most of these tests describe a finished sprint, so the line covers its
   * whole span. The one that does not is the last: a running sprint stops the
   * line at today rather than drawing days that have not happened.
   */
  const AFTER_SPRINT = new Date("2026-05-01T00:00:00.000Z");

  it("produce un punto per ogni giorno lavorativo, saltando il fine settimana", () => {
    /*
     * Lo sprint va da lunedì 6 a venerdì 17 aprile: dodici giorni di
     * calendario, dieci lavorativi.
     *
     * Prima questa metrica ne produceva dodici, e i due punti in più cadevano
     * su sabato e domenica — giorni in cui i dati sintetici non producono
     * niente, quindi la linea si appiattiva. Kniberg racconta di aver fatto e
     * disfatto esattamente questo: la piattezza del fine settimana «would look
     * like a warning sign». Un grafico che inventa allarmi insegna a ignorare
     * quelli veri.
     */
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const result = burndown(sprint(), [item({ id: ITEM_A })], [], events, AFTER_SPRINT);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toHaveLength(10);
    expect(result.value.totalWorkingDays).toBe(10);

    const weekendDays = result.value.points.filter((point) =>
      [0, 6].includes(point.at.getUTCDay()),
    );
    expect(weekendDays).toHaveLength(0);
  });

  it("rispetta le festività dichiarate dal progetto", () => {
    // Un ponte non è un giorno di lavoro fermo: è un giorno che non c'è.
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const result = burndown(sprint(), [item({ id: ITEM_A })], [], events, AFTER_SPRINT, {
      calendar: { ...DEFAULT_WORKING_CALENDAR, holidays: ["2026-04-07"] },
    });

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toHaveLength(9);
    expect(
      result.value.points.some((point) => point.at.toISOString().startsWith("2026-04-07")),
    ).toBe(false);
  });

  it("la linea ideale scende fino all'ultimo giorno, non fino a oggi", () => {
    /*
     * Il difetto che questa riga chiude: la linea tratteggiata veniva scalata
     * sui punti disponibili, quindi su uno sprint in corso arrivava a zero
     * *oggi*. Ogni sprint sembrava disperatamente in ritardo fino all'ultimo
     * giorno.
     */
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const items = [item({ id: ITEM_A, estimate: { value: 9, unit: "points" } })];

    const result = burndown(
      sprint(),
      items,
      [],
      events,
      new Date("2026-04-09T12:00:00.000Z"),
    );
    if (!result.available) throw new Error("attesa disponibile");

    // Dieci giorni lavorativi, nove passi: si scende di un punto al giorno.
    expect(result.value.points[0]?.ideal).toBe(9);
    expect(result.value.points[1]?.ideal).toBe(8);
    expect(result.value.totalWorkingDays).toBe(10);

    // E la linea reale si ferma prima, com'è giusto.
    expect(result.value.points.length).toBeLessThan(result.value.totalWorkingDays);
  });

  it("usa la stima del giorno, non quella corrente", () => {
    /*
     * Il burndown è la risposta corrente del team a «quanto manca», e una
     * ri-stima ne fa parte: è il contrario della velocity, che congela la
     * stima d'ingresso.
     */
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const items = [item({ id: ITEM_A, estimate: { value: 13, unit: "points" } })];
    const changes = [
      estimateChange(ITEM_A, null, { value: 5, unit: "points" }, "2026-04-06T08:00:00.000Z"),
      estimateChange(
        ITEM_A,
        { value: 5, unit: "points" },
        { value: 13, unit: "points" },
        "2026-04-09T10:00:00.000Z",
      ),
    ];

    const result = burndown(sprint(), items, [], events, AFTER_SPRINT, {
      estimateChanges: changes,
    });
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.points[0]?.remaining.points).toBe(5);
    expect(result.value.points[result.value.points.length - 1]?.remaining.points).toBe(13);
  });

  it("la linea sale quando arriva lavoro a metà sprint", () => {
    // È l'intero valore diagnostico del grafico: senza ricalcolare
    // l'appartenenza a ogni punto, l'aggiunta sarebbe invisibile.
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-10T09:00:00.000Z"),
    ];
    const items = [
      item({ id: ITEM_A, estimate: { value: 5, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 8, unit: "points" } }),
    ];

    const result = burndown(sprint(), items, [], events, AFTER_SPRINT);
    if (!result.available) throw new Error("attesa disponibile");

    const first = result.value.points[0];
    const later = result.value.points.find(
      (p) => p.at.getTime() > new Date("2026-04-10T09:00:00.000Z").getTime(),
    );

    expect(first?.remaining.points).toBe(5);
    expect(later?.remaining.points).toBe(13);
  });

  it("gestisce uno sprint di un solo giorno", () => {
    const oneDay = sprint({ startsAt: "2026-04-06T08:00:00.000Z", endsAt: "2026-04-06T18:00:00.000Z" });
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];

    const result = burndown(oneDay, [item({ id: ITEM_A })], [], events, AFTER_SPRINT);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toHaveLength(1);

    // Nessuna linea ideale: un solo giorno non ha pendenza, e zero sarebbe
    // una divisione per zero travestita da numero.
    expect(result.value.points[0]?.ideal).toBeNull();
  });

  it("non è disponibile se lo sprint non ha nemmeno un giorno lavorativo", () => {
    // Un fine settimana intero non è uno sprint vuoto: è uno sprint che non
    // contiene nessun giorno da campionare. Dichiararlo, invece di restituire
    // una serie vuota che il grafico disegnerebbe come una riga piatta.
    const weekend = sprint({
      startsAt: "2026-04-11T08:00:00.000Z",
      endsAt: "2026-04-12T18:00:00.000Z",
    });
    const events = [scopeEvent(ITEM_A, "added", "2026-04-11T08:00:00.000Z")];

    const result = burndown(weekend, [item({ id: ITEM_A })], [], events, AFTER_SPRINT);
    expect(result.available).toBe(false);
  });

  it("si ferma a oggi invece di disegnare i giorni non ancora avvenuti", () => {
    /*
     * Uno sprint in corso ha giorni che non sono accaduti, e campionarli
     * produce punti identici all'ultimo reale: una coda piatta che si legge
     * come una settimana di lavoro fermo.
     *
     * Il grafico affermerebbe qualcosa sul futuro — falso, e per giunta poco
     * lusinghiero. Fermare la linea dove finiscono i dati dice solo ciò che si
     * sa. È il difetto che è comparso il giorno in cui lo scenario ha smesso
     * di essere tutto nel passato.
     */
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const midSprint = new Date("2026-04-09T12:00:00.000Z");

    const result = burndown(sprint(), [item({ id: ITEM_A })], [], events, midSprint);
    if (!result.available) throw new Error("attesa disponibile");

    const last = result.value.points[result.value.points.length - 1];
    expect(last?.at.getTime()).toBeLessThanOrEqual(midSprint.getTime());

    // E resta più corta della linea dello stesso sprint guardato a cose fatte.
    const whole = burndown(sprint(), [item({ id: ITEM_A })], [], events, AFTER_SPRINT);
    if (!whole.available) throw new Error("attesa disponibile");

    expect(result.value.points.length).toBeLessThan(whole.value.points.length);
  });
});

describe("throughput", () => {
  it("conta gli elementi conclusi nella finestra", () => {
    const transitions = [
      move(null, "done", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "done", "2026-04-20T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = throughput(
      transitions,
      new Date("2026-04-06T00:00:00.000Z"),
      new Date("2026-04-17T23:59:59.000Z"),
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("conta una sola volta un elemento concluso più volte", () => {
    const transitions = [
      move(null, "done", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move("done", "in_progress", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-10T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = throughput(
      transitions,
      new Date("2026-04-06T00:00:00.000Z"),
      new Date("2026-04-17T00:00:00.000Z"),
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("non è disponibile su una finestra vuota o invertita", () => {
    const instant = new Date("2026-04-06T00:00:00.000Z");
    expect(throughput([], instant, instant).available).toBe(false);
    expect(throughput([], new Date("2026-04-10T00:00:00.000Z"), instant).available).toBe(false);
  });
});

describe("workInProgress", () => {
  it("conta gli elementi negli stati attivi", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "in_review", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_B }),
      move(null, "todo", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_C }),
    ];

    const result = workInProgress(transitions, new Date("2026-04-09T00:00:00.000Z"));
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(2);
  });

  it("non conta gli elementi bloccati", () => {
    // Un elemento che nessuno può muovere non è lavoro in corso: contarlo
    // lascerebbe una squadra ferma con il limite di WIP apparentemente
    // rispettato.
    const transitions = [
      move(null, "blocked", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = workInProgress(transitions, new Date("2026-04-09T00:00:00.000Z"));
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(0);
  });

  it("non è disponibile senza dati", () => {
    expect(workInProgress([], new Date("2026-04-09T00:00:00.000Z")).available).toBe(false);
  });

  it("misura l'istante richiesto, non l'ultimo stato", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-12T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const during = workInProgress(transitions, new Date("2026-04-10T00:00:00.000Z"));
    const after = workInProgress(transitions, new Date("2026-04-14T00:00:00.000Z"));

    if (!during.available || !after.available) throw new Error("attese disponibili");
    expect(during.value).toBe(1);
    expect(after.value).toBe(0);
  });
});

describe("workItemsByState", () => {
  const INSTANT = new Date("2026-04-09T00:00:00.000Z");

  it("conta gli elementi stato per stato", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "in_review", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_B }),
      move(null, "in_review", "2026-04-08T10:00:00.000Z", { workItemId: ITEM_C }),
    ];

    const result = workItemsByState(transitions, INSTANT);
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.get("in_progress")).toBe(1);
    expect(result.value.get("in_review")).toBe(2);
  });

  it("dichiara zero per gli stati vuoti, invece di ometterli", () => {
    /*
     * Uno stato assente dalla mappa si legge come «non lo so» a chi la
     * riceve, mentre qui si sa: è zero. Lasciare che il chiamante distingua
     * i due casi è il modo in cui una bacheca finisce per mostrare una
     * casella vuota dove dovrebbe esserci uno zero.
     */
    const transitions = [
      move(null, "todo", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = workItemsByState(transitions, INSTANT);
    if (!result.available) throw new Error("attesa disponibile");

    expect(result.value.get("done")).toBe(0);
    expect(result.value.get("blocked")).toBe(0);
    expect(result.value.has("cancelled")).toBe(true);
  });

  it("guarda l'istante richiesto, non l'ultimo stato conosciuto", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-12T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const during = workItemsByState(transitions, new Date("2026-04-10T00:00:00.000Z"));
    const after = workItemsByState(transitions, new Date("2026-04-14T00:00:00.000Z"));

    if (!during.available || !after.available) throw new Error("attese disponibili");
    expect(during.value.get("in_progress")).toBe(1);
    expect(during.value.get("done")).toBe(0);
    expect(after.value.get("in_progress")).toBe(0);
    expect(after.value.get("done")).toBe(1);
  });

  it("non è disponibile senza storia degli stati", () => {
    // Una bacheca tutta a zero afferma che le colonne sono vuote. Qui non si
    // sa nemmeno se esistano elementi: sono due cose diverse.
    expect(workItemsByState([], INSTANT).available).toBe(false);
  });

  it("dichiara su quanti elementi ha guardato", () => {
    const transitions = [
      move(null, "todo", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "todo", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = workItemsByState(transitions, INSTANT);
    expect(result.sampleSize).toBe(2);
  });
});

describe("sprintItemCount", () => {
  const AFTER = new Date("2026-05-01T00:00:00.000Z");

  it("conta gli elementi presenti alla chiusura", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-08T09:00:00.000Z"),
    ];

    const result = sprintItemCount(sprint(), events, AFTER);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(2);
  });

  it("non conta gli elementi usciti prima della chiusura", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-08T09:00:00.000Z"),
      scopeEvent(ITEM_B, "removed", "2026-04-10T09:00:00.000Z"),
    ];

    const result = sprintItemCount(sprint(), events, AFTER);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("ignora le variazioni di un altro sprint", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-07T08:00:00.000Z", OTHER_SPRINT_ID),
    ];

    const result = sprintItemCount(sprint(), events, AFTER);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("uno sprint ancora in corso si ferma a adesso, non alla data di fine", () => {
    // Contare fino alla fine pianificata significherebbe includere ingressi
    // che non sono ancora avvenuti: una composizione futura spacciata per
    // misura.
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-15T09:00:00.000Z"),
    ];

    const result = sprintItemCount(sprint(), events, new Date("2026-04-10T00:00:00.000Z"));
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("uno sprint chiuso in anticipo si conta alla chiusura reale", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-16T09:00:00.000Z"),
    ];

    const closed = sprint({ completedAt: "2026-04-15T18:00:00.000Z" });
    const result = sprintItemCount(closed, events, AFTER);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(1);
  });

  it("dichiara quante variazioni ha letto", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "added", "2026-04-08T09:00:00.000Z"),
      scopeEvent(ITEM_B, "removed", "2026-04-10T09:00:00.000Z"),
    ];

    expect(sprintItemCount(sprint(), events, AFTER).sampleSize).toBe(3);
  });

  it("senza variazioni di perimetro non risponde zero, dice che non lo sa", () => {
    const result = sprintItemCount(sprint(), [], AFTER);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-data");
  });

  it("uno sprint svuotato è uno zero misurato, non una lacuna", () => {
    const events = [
      scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_A, "removed", "2026-04-07T08:00:00.000Z"),
    ];

    const result = sprintItemCount(sprint(), events, AFTER);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(0);
  });
});

describe("insieme vuoto", () => {
  it("nessuna metrica di sprint restituisce zero muto", () => {
    const empty = sprint();

    expect(velocity(empty, [], [], []).available).toBe(false);
    expect(scopeChange(empty, [], []).available).toBe(false);
    expect(carryOver(empty, [], [], []).available).toBe(false);
    expect(workInProgress([], empty.startsAt).available).toBe(false);
    expect(sprintItemCount(empty, [], empty.endsAt).available).toBe(false);
  });
});

describe("durata di riferimento", () => {
  it("il burndown copre l'intero arco lavorativo dello sprint", () => {
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const result = burndown(
      sprint(),
      [item({ id: ITEM_A })],
      [],
      events,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    if (!result.available) throw new Error("attesa disponibile");
    const points = result.value.points;
    const first = points[0];
    const last = points[points.length - 1];

    expect(first?.at.toISOString()).toBe("2026-04-06T08:00:00.000Z");
    // Lunedì 6 → venerdì 17: undici giorni di distanza, dieci campioni,
    // perché i due fine settimana in mezzo non sono giorni di lavoro.
    expect((last as { at: Date }).at.getTime() - (first as { at: Date }).at.getTime()).toBe(11 * DAY);
    expect(points).toHaveLength(10);
  });
});
