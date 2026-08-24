import { beforeEach, describe, expect, it } from "vitest";

import { sprintSchema, sprintScopeEventSchema, type Sprint, type SprintScopeEvent } from "@/domain";
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

import { DAY, item, move, resetIds } from "./builders";

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
  it("produce un punto per ogni giorno dello sprint", () => {
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const result = burndown(sprint(), [item({ id: ITEM_A })], [], events);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toHaveLength(12);
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

    const result = burndown(sprint(), items, [], events);
    if (!result.available) throw new Error("attesa disponibile");

    const first = result.value[0];
    const later = result.value.find((p) => p.at.getTime() > new Date("2026-04-10T09:00:00.000Z").getTime());

    expect(first?.remaining.points).toBe(5);
    expect(later?.remaining.points).toBe(13);
  });

  it("gestisce uno sprint di un solo giorno", () => {
    const oneDay = sprint({ startsAt: "2026-04-06T08:00:00.000Z", endsAt: "2026-04-06T18:00:00.000Z" });
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];

    const result = burndown(oneDay, [item({ id: ITEM_A })], [], events);
    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toHaveLength(1);
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
  it("il burndown copre l'intero arco dello sprint", () => {
    const events = [scopeEvent(ITEM_A, "added", "2026-04-06T08:00:00.000Z")];
    const result = burndown(sprint(), [item({ id: ITEM_A })], [], events);

    if (!result.available) throw new Error("attesa disponibile");
    const first = result.value[0];
    const last = result.value[result.value.length - 1];

    expect(first?.at.toISOString()).toBe("2026-04-06T08:00:00.000Z");
    expect((last as { at: Date }).at.getTime() - (first as { at: Date }).at.getTime()).toBe(11 * DAY);
  });
});
