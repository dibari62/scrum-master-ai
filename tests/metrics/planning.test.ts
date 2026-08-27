import { beforeEach, describe, expect, it } from "vitest";

import {
  sprintSchema,
  sprintScopeEventSchema,
  teamMemberAvailabilitySchema,
  type Sprint,
  type SprintScopeEvent,
  type TeamMemberAvailability,
} from "@/domain";
import {
  availableManDays,
  committedVelocity,
  DEFAULT_FOCUS_FACTOR,
  estimatedVelocity,
  focusFactor,
  forecastVariance,
  yesterdaysWeather,
} from "@/metrics";

import { item, move, resetIds } from "./builders";

/**
 * Capacità e previsione, verificate **sugli esempi numerici stampati nel
 * libro**.
 *
 * È la forma di test che ADR-0008 impone per questo modulo: se il codice non
 * ritrova 50, 40%, 20 e 19, ha torto il codice. Un test scritto sui numeri che
 * il codice già produce non verifica una formula, la fotografa.
 */

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";

const SPRINT_ID = "2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35";
const PREVIOUS_SPRINT_ID = "6b1f9d02-4a83-4e57-b16c-9f2d7e40a8c1";

const LISA = "11111111-0000-4000-8000-000000000001";
const DAVE = "22222222-0000-4000-8000-000000000002";
const TOM = "33333333-0000-4000-8000-000000000003";
const SAM = "44444444-0000-4000-8000-000000000004";

const ITEM_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ITEM_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ITEM_C = "cccccccc-0000-4000-8000-000000000003";
const ITEM_D = "dddddddd-0000-4000-8000-000000000004";

const SCOPE = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  sourceSystem: "seed",
} as const;

beforeEach(() => resetIds());

/**
 * Tre settimane di calendario che contengono quindici giorni lavorativi.
 *
 * È la durata dell'esempio del libro — «a three-week sprint (15 work days)» —
 * e il fatto che i giorni di calendario siano ventuno è esattamente ciò che il
 * calendario lavorativo esiste per non confondere.
 */
function threeWeekSprint(overrides: Partial<{ id: string; completedAt: string | null }> = {}): Sprint {
  return sprintSchema.parse({
    id: overrides.id ?? SPRINT_ID,
    ...SCOPE,
    sourceId: `sprint-${overrides.id ?? SPRINT_ID}`,
    name: "Sprint di tre settimane",
    goal: null,
    // Lunedì 6 aprile → venerdì 24 aprile: 15 giorni lavorativi.
    startsAt: "2026-04-06T08:00:00.000Z",
    endsAt: "2026-04-24T18:00:00.000Z",
    completedAt: overrides.completedAt === undefined ? null : overrides.completedAt,
    createdAt: "2026-04-06T08:00:00.000Z",
    updatedAt: "2026-04-06T08:00:00.000Z",
  });
}

function availability(
  personId: string,
  allocationShare: number,
  absentWorkingDays: number,
  sprintId = SPRINT_ID,
): TeamMemberAvailability {
  return teamMemberAvailabilitySchema.parse({
    ...SCOPE,
    sprintId,
    personId,
    allocationShare,
    absentWorkingDays,
    createdAt: "2026-04-06T08:00:00.000Z",
    updatedAt: "2026-04-06T08:00:00.000Z",
  });
}

let eventCounter = 0;

function scopeEvent(
  workItemId: string,
  occurredAt: string,
  sprintId = SPRINT_ID,
): SprintScopeEvent {
  eventCounter += 1;
  return sprintScopeEventSchema.parse({
    ...SCOPE,
    sourceId: `scope-${eventCounter}`,
    sprintId,
    workItemId,
    kind: "added",
    reason: null,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

describe("availableManDays — l'esempio di pagina 30", () => {
  it("ritrova i 50 man-days del libro", () => {
    /*
     * «Let's say we are planning a three-week sprint (15 work days) with a
     * four-person team. Lisa will be on vacation for two days. Dave is only 50%
     * available and will be on vacation for one day. Putting all this together
     * … gives us 50 available man-days for this sprint.»
     *
     * 15 (Tom) + 13 (Lisa) + 15 (Sam) + 6,5 (Dave) = 49,5.
     *
     * Il libro scrive 50: è un arrotondamento suo, non nostro. Verifichiamo
     * l'aritmetica esatta e dichiariamo la differenza invece di piegare il
     * codice per farla sparire.
     */
    const result = availableManDays(threeWeekSprint(), [
      availability(TOM, 1, 0),
      availability(LISA, 1, 2),
      availability(SAM, 1, 0),
      availability(DAVE, 0.5, 1),
    ]);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(49.5);
    expect(Math.round(result.value)).toBe(50);
    expect(result.sampleSize).toBe(4);
  });

  it("sottrae le assenze dopo l'allocazione, non prima", () => {
    /*
     * Dave è a metà tempo e via un giorno. Il libro arriva a 6,5, cioè
     * 7,5 − 1. Sottrarre prima darebbe (15 − 1) × 0,5 = 7.
     *
     * Un giorno di assenza è un giorno intero tolto dal piano, qualunque quota
     * di esso la persona avrebbe dato.
     */
    const result = availableManDays(threeWeekSprint(), [availability(DAVE, 0.5, 1)]);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(6.5);
  });

  it("conta i giorni lavorativi, non quelli di calendario", () => {
    // Tre settimane sono ventuno giorni di calendario e quindici lavorativi.
    // Confonderli gonfierebbe la capacità del quaranta per cento.
    const result = availableManDays(threeWeekSprint(), [availability(TOM, 1, 0)]);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(15);
  });

  it("una persona interamente assente non toglie giorni ai colleghi", () => {
    // Senza il limite a zero, chi è via più giorni di quanti ne lavora
    // produrrebbe una capacità negativa che cancella quella di un altro.
    const result = availableManDays(threeWeekSprint(), [
      availability(TOM, 1, 0),
      availability(LISA, 0.5, 20),
    ]);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(15);
  });

  it("senza disponibilità dichiarate non risponde zero, dice che non lo sa", () => {
    // Zero capacità e «nessuno ha dichiarato la capacità» sono affermazioni
    // diverse, e stamparle uguali è come stampare 0 per una metrica assente.
    const result = availableManDays(threeWeekSprint(), []);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-data");
  });

  it("ignora la disponibilità dichiarata per un altro sprint", () => {
    const result = availableManDays(threeWeekSprint(), [
      availability(TOM, 1, 0, PREVIOUS_SPRINT_ID),
    ]);

    expect(result.available).toBe(false);
  });
});

describe("focusFactor — l'esempio di pagina 31", () => {
  /**
   * «Let's say last sprint completed 18 story points using a three-person team
   * consisting of Tom, Lisa, and Sam working three weeks for a total of 45
   * man-days.»
   *
   * 18 / 45 = 0,4.
   */
  const closed = threeWeekSprint({ completedAt: "2026-04-24T18:00:00.000Z" });

  const events = [
    scopeEvent(ITEM_A, "2026-04-06T08:00:00.000Z"),
    scopeEvent(ITEM_B, "2026-04-06T08:00:00.000Z"),
  ];

  // 10 + 8 = 18 punti conclusi.
  const items = [
    item({ id: ITEM_A, estimate: { value: 10, unit: "points" } }),
    item({ id: ITEM_B, estimate: { value: 8, unit: "points" } }),
  ];

  const finished = [
    move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
    move("todo", "done", "2026-04-10T09:00:00.000Z", { workItemId: ITEM_A }),
    move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_B }),
    move("todo", "done", "2026-04-15T09:00:00.000Z", { workItemId: ITEM_B }),
  ];

  // Tre persone a tempo pieno per quindici giorni lavorativi: 45 man-days.
  const team = [
    availability(TOM, 1, 0),
    availability(LISA, 1, 0),
    availability(SAM, 1, 0),
  ];

  it("ritrova il 40% del libro", () => {
    const result = focusFactor(closed, items, finished, events, team);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBeCloseTo(0.4, 10);
  });

  it("non è calcolabile con unità di stima miste", () => {
    /*
     * La regola di ADR-0008. Il rapporto ha senso perché il libro tratta un
     * punto storia come un giorno-uomo ideale; punti e ore divisi per giorni
     * sono aritmetica su due scale incompatibili.
     */
    const mixed = [
      item({ id: ITEM_A, estimate: { value: 10, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 8, unit: "hours" } }),
    ];

    const result = focusFactor(closed, mixed, finished, events, team);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("mixed-estimate-units");
  });

  it("con sole stime in ore dichiara che la domanda non si applica", () => {
    const hours = [
      item({ id: ITEM_A, estimate: { value: 10, unit: "hours" } }),
      item({ id: ITEM_B, estimate: { value: 8, unit: "hours" } }),
    ];

    const result = focusFactor(closed, hours, finished, events, team);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-qualifying-data");
  });

  it("non viene limitato a uno quando la squadra supera la propria capacità", () => {
    /*
     * Limitarlo cancellerebbe il segnale che dice di guardare le stime.
     * Un solo giorno-uomo disponibile e diciotto punti chiusi: 18.
     */
    const result = focusFactor(closed, items, finished, events, [
      availability(TOM, 1, 14),
    ]);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(18);
  });

  it("una capacità di zero non produce una divisione per zero", () => {
    const result = focusFactor(closed, items, finished, events, [
      availability(TOM, 0, 0),
    ]);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("empty-denominator");
  });
});

describe("yesterdaysWeather", () => {
  const events = [
    scopeEvent(ITEM_A, "2026-04-06T08:00:00.000Z", PREVIOUS_SPRINT_ID),
    scopeEvent(ITEM_B, "2026-04-06T08:00:00.000Z", PREVIOUS_SPRINT_ID),
  ];

  const items = [
    item({ id: ITEM_A, estimate: { value: 10, unit: "points" } }),
    item({ id: ITEM_B, estimate: { value: 8, unit: "points" } }),
  ];

  const finished = [
    move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
    move("todo", "done", "2026-04-10T09:00:00.000Z", { workItemId: ITEM_A }),
    move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_B }),
    move("todo", "done", "2026-04-15T09:00:00.000Z", { workItemId: ITEM_B }),
  ];

  const previous = threeWeekSprint({
    id: PREVIOUS_SPRINT_ID,
    completedAt: "2026-04-24T18:00:00.000Z",
  });

  it("prende la velocity degli sprint conclusi", () => {
    const result = yesterdaysWeather(
      [previous],
      items,
      finished,
      events,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(18);
  });

  it("ignora lo sprint ancora in corso", () => {
    /*
     * Uno sprint aperto non ha finito di consegnare, e mediarne il parziale
     * abbasserebbe ogni previsione per un motivo che dipende solo da quando è
     * stata posta la domanda.
     */
    const running = threeWeekSprint({ id: SPRINT_ID, completedAt: null });

    const result = yesterdaysWeather(
      [previous, running],
      items,
      finished,
      events,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(18);
    expect(result.sampleSize).toBe(1);
  });

  it("senza sprint conclusi non inventa una previsione", () => {
    const result = yesterdaysWeather(
      [threeWeekSprint()],
      items,
      finished,
      events,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-qualifying-data");
  });
});

describe("estimatedVelocity", () => {
  const previous = threeWeekSprint({
    id: PREVIOUS_SPRINT_ID,
    completedAt: "2026-04-03T18:00:00.000Z",
  });
  const upcoming = threeWeekSprint();

  const events = [
    scopeEvent(ITEM_A, "2026-03-16T08:00:00.000Z", PREVIOUS_SPRINT_ID),
    scopeEvent(ITEM_B, "2026-03-16T08:00:00.000Z", PREVIOUS_SPRINT_ID),
  ];

  const items = [
    item({ id: ITEM_A, estimate: { value: 10, unit: "points" } }),
    item({ id: ITEM_B, estimate: { value: 8, unit: "points" } }),
  ];

  const finished = [
    move(null, "todo", "2026-03-16T08:00:00.000Z", { workItemId: ITEM_A }),
    move("todo", "done", "2026-03-20T09:00:00.000Z", { workItemId: ITEM_A }),
    move(null, "todo", "2026-03-16T08:00:00.000Z", { workItemId: ITEM_B }),
    move("todo", "done", "2026-03-25T09:00:00.000Z", { workItemId: ITEM_B }),
  ];

  it("usa il meteo di ieri come predefinito, ed è quello che l'autore consiglia", () => {
    const result = estimatedVelocity({
      sprint: upcoming,
      sprints: [previous, upcoming],
      items,
      transitions: finished,
      scopeEvents: events,
    });

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBe(18);
    expect(result.value.method).toBe("yesterdays-weather");
    // Nessun focus factor dedotto: il metodo non ne calcola uno, e riportarlo
    // inventerebbe una precisione che non dichiara.
    expect(result.value.focusFactor).toBeNull();
  });

  it("ritrova i 20 punti dell'esempio di pagina 31 con il focus factor", () => {
    /*
     * «Taking vacations and stuff into account we have 50 man-days next sprint
     * … So our estimated velocity for the upcoming sprint is 20 story points.»
     *
     * Lo sprint precedente: 18 punti su 45 man-days ⇒ 40%.
     * Quello nuovo: 50 man-days × 40% = 20.
     */
    const previousTeam = [
      availability(TOM, 1, 0, PREVIOUS_SPRINT_ID),
      availability(LISA, 1, 0, PREVIOUS_SPRINT_ID),
      availability(SAM, 1, 0, PREVIOUS_SPRINT_ID),
    ];

    // Quattro persone, una assente due giorni, una a metà tempo e via un
    // giorno: i 49,5 dell'esempio, che il libro arrotonda a 50.
    const upcomingTeam = [
      availability(TOM, 1, 0),
      availability(LISA, 1, 2),
      availability(SAM, 1, 0),
      availability(DAVE, 0.5, 1),
    ];

    const result = estimatedVelocity({
      sprint: upcoming,
      sprints: [previous, upcoming],
      items,
      transitions: finished,
      scopeEvents: events,
      availabilities: [...previousTeam, ...upcomingTeam],
      method: "focus-factor",
    });

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.focusFactor).toBeCloseTo(0.4, 10);
    expect(Math.round(result.value.points)).toBe(20);
  });

  it("per un team nuovo ripiega sul 70% dichiarato dal libro", () => {
    expect(DEFAULT_FOCUS_FACTOR).toBe(0.7);

    const result = estimatedVelocity({
      sprint: upcoming,
      sprints: [upcoming],
      items: [],
      transitions: [],
      scopeEvents: [],
      availabilities: [availability(TOM, 1, 0)],
      method: "default-focus-factor",
    });

    if (!result.available) throw new Error("attesa disponibile");
    // 15 giorni lavorativi × 70%.
    expect(result.value.points).toBeCloseTo(10.5, 10);
    expect(result.value.method).toBe("default-focus-factor");
  });

  it("un metodo senza dati dichiara il proprio motivo invece di cambiare metodo", () => {
    /*
     * Una previsione che ripiega in silenzio su un altro metodo è peggio di
     * nessuna previsione: nessuno può contestarla, perché nessuno sa cosa
     * afferma.
     */
    const result = estimatedVelocity({
      sprint: upcoming,
      sprints: [previous, upcoming],
      items,
      transitions: finished,
      scopeEvents: events,
      method: "focus-factor",
    });

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-data");
  });
});

describe("committedVelocity — l'esempio di pagina 32", () => {
  it("somma le storie scelte, non il bersaglio", () => {
    /*
     * «In this case, the team may choose the top four stories for a total of 19
     * story points … Since these four stories add up to 19 story points, their
     * final estimated velocity for this sprint is 19.»
     *
     * Il bersaglio era 20. Il piano è 19.
     */
    const events = [
      scopeEvent(ITEM_A, "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_C, "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_D, "2026-04-06T08:00:00.000Z"),
    ];

    const items = [
      item({ id: ITEM_A, estimate: { value: 8, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 5, unit: "points" } }),
      item({ id: ITEM_C, estimate: { value: 3, unit: "points" } }),
      item({ id: ITEM_D, estimate: { value: 3, unit: "points" } }),
    ];

    const result = committedVelocity(threeWeekSprint(), items, events);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBe(19);
    expect(result.sampleSize).toBe(4);
  });

  it("non conta il lavoro entrato dopo l'inizio", () => {
    // Ciò che arriva dopo è una variazione di perimetro, ed è `scopeChange` a
    // dirlo. Sommarlo qui farebbe sembrare che la squadra si fosse impegnata
    // su qualcosa che ancora non esisteva.
    const events = [
      scopeEvent(ITEM_A, "2026-04-06T08:00:00.000Z"),
      scopeEvent(ITEM_B, "2026-04-13T09:00:00.000Z"),
    ];

    const items = [
      item({ id: ITEM_A, estimate: { value: 8, unit: "points" } }),
      item({ id: ITEM_B, estimate: { value: 5, unit: "points" } }),
    ];

    const result = committedVelocity(threeWeekSprint(), items, events);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.points).toBe(8);
  });

  it("uno sprint senza stime dichiara la lacuna invece di rispondere zero", () => {
    const events = [scopeEvent(ITEM_A, "2026-04-06T08:00:00.000Z")];
    const result = committedVelocity(
      threeWeekSprint(),
      [item({ id: ITEM_A, estimate: null })],
      events,
    );

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-qualifying-data");
  });
});

describe("forecastVariance", () => {
  const events = [scopeEvent(ITEM_A, "2026-04-06T08:00:00.000Z")];
  const items = [item({ id: ITEM_A, estimate: { value: 13, unit: "points" } })];
  const finished = [
    move(null, "todo", "2026-04-06T08:00:00.000Z", { workItemId: ITEM_A }),
    move("todo", "done", "2026-04-10T09:00:00.000Z", { workItemId: ITEM_A }),
  ];

  const closed = threeWeekSprint({ completedAt: "2026-04-24T18:00:00.000Z" });

  it("è negativo quando si consegna meno del previsto", () => {
    const result = forecastVariance(closed, items, finished, events, 20);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(-7);
  });

  it("è positivo quando si consegna di più", () => {
    const result = forecastVariance(closed, items, finished, events, 10);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(3);
  });

  it("senza velocity effettiva non inventa uno scostamento", () => {
    const result = forecastVariance(closed, [], [], [], 20);
    expect(result.available).toBe(false);
  });
});
