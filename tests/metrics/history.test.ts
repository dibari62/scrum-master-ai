import { beforeEach, describe, expect, it } from "vitest";

import {
  firstEntryInto,
  lastEntryInto,
  normaliseHistory,
  reopenCount,
  stateAt,
  stateIntervals,
  timeInState,
} from "@/metrics";

import { DAY, HOUR, move, resetIds } from "./builders";

const ASOF = new Date("2026-04-20T09:00:00.000Z");

beforeEach(() => resetIds());

describe("normaliseHistory", () => {
  it("restituisce un elenco vuoto per una storia vuota", () => {
    expect(normaliseHistory([])).toEqual([]);
  });

  it("ordina le transizioni ricevute alla rinfusa", () => {
    const a = move(null, "todo", "2026-04-06T09:00:00.000Z");
    const b = move("todo", "in_progress", "2026-04-07T09:00:00.000Z");
    const c = move("in_progress", "done", "2026-04-08T09:00:00.000Z");

    expect(normaliseHistory([c, a, b]).map((t) => t.toState)).toEqual([
      "todo",
      "in_progress",
      "done",
    ]);
  });

  it("elimina i duplicati con lo stesso identificativo", () => {
    // Un connettore che rielabora una finestra già importata li produce
    // facilmente: senza questa difesa il tempo in stato verrebbe contato due
    // volte.
    const a = move(null, "todo", "2026-04-06T09:00:00.000Z", { id: "00000000-0000-4000-8000-000000000099" });
    const duplicate = move(null, "todo", "2026-04-06T09:00:00.000Z", {
      id: "00000000-0000-4000-8000-000000000099",
    });

    expect(normaliseHistory([a, duplicate])).toHaveLength(1);
  });

  it("ordina in modo riproducibile due transizioni con lo stesso istante", () => {
    // Una modifica in blocco produce timestamp identici. L'ordine deve
    // dipendere dall'identificativo, non da come arrivano le righe.
    const same = "2026-04-06T09:00:00.000Z";
    const a = move(null, "todo", same);
    const b = move("todo", "in_progress", same);

    expect(normaliseHistory([b, a]).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(normaliseHistory([a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
  });
});

describe("stateIntervals", () => {
  it("è vuoto senza transizioni", () => {
    expect(stateIntervals([], ASOF)).toEqual([]);
  });

  it("calcola la durata di ogni stato attraversato", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "done", "2026-04-09T09:00:00.000Z"),
    ];

    const intervals = stateIntervals(history, ASOF);

    expect(intervals.map((i) => [i.state, i.duration])).toEqual([
      ["todo", 1 * DAY],
      ["in_progress", 2 * DAY],
      ["done", new Date("2026-04-20T09:00:00.000Z").getTime() - new Date("2026-04-09T09:00:00.000Z").getTime()],
    ]);
  });

  it("lascia aperto l'ultimo intervallo e lo misura fino all'istante di riferimento", () => {
    const history = [move(null, "todo", "2026-04-19T09:00:00.000Z")];
    const [interval] = stateIntervals(history, ASOF);

    expect(interval?.to).toBeNull();
    expect(interval?.duration).toBe(1 * DAY);
  });

  it("non produce durate negative se l'istante di riferimento precede la storia", () => {
    // Capiterebbe guardando uno sprint passato: senza il taglio a zero, una
    // durata negativa sottrarrebbe silenziosamente dai totali.
    const history = [move(null, "todo", "2026-04-19T09:00:00.000Z")];
    const [interval] = stateIntervals(history, new Date("2026-04-01T00:00:00.000Z"));

    expect(interval?.duration).toBe(0);
  });
});

describe("timeInState", () => {
  it("somma più permanenze nello stesso stato", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
      move("in_progress", "blocked", "2026-04-08T09:00:00.000Z"),
      move("blocked", "in_progress", "2026-04-10T09:00:00.000Z"),
      move("in_progress", "blocked", "2026-04-11T09:00:00.000Z"),
      move("blocked", "done", "2026-04-12T09:00:00.000Z"),
    ];

    expect(timeInState(history, "blocked", ASOF)).toBe(3 * DAY);
  });

  it("restituisce zero per uno stato mai attraversato", () => {
    const history = [move(null, "todo", "2026-04-06T09:00:00.000Z")];
    expect(timeInState(history, "blocked", ASOF)).toBe(0);
  });
});

describe("firstEntryInto e lastEntryInto", () => {
  const history = [
    move(null, "todo", "2026-04-06T09:00:00.000Z"),
    move("todo", "in_progress", "2026-04-07T09:00:00.000Z"),
    move("in_progress", "done", "2026-04-08T09:00:00.000Z"),
    move("done", "in_progress", "2026-04-09T09:00:00.000Z"),
    move("in_progress", "done", "2026-04-10T09:00:00.000Z"),
  ];

  it("distingue il primo ingresso dall'ultimo", () => {
    expect(firstEntryInto(history, "done")?.toISOString()).toBe("2026-04-08T09:00:00.000Z");
    expect(lastEntryInto(history, "done")?.toISOString()).toBe("2026-04-10T09:00:00.000Z");
  });

  it("restituisce null per uno stato mai raggiunto", () => {
    expect(firstEntryInto(history, "cancelled")).toBeNull();
    expect(lastEntryInto(history, "cancelled")).toBeNull();
  });
});

describe("stateAt", () => {
  const history = [
    move(null, "todo", "2026-04-06T09:00:00.000Z"),
    move("todo", "in_progress", "2026-04-08T09:00:00.000Z"),
  ];

  it("è null prima che l'elemento esistesse", () => {
    expect(stateAt(history, new Date("2026-04-05T00:00:00.000Z"))).toBeNull();
  });

  it("restituisce lo stato in vigore all'istante richiesto", () => {
    expect(stateAt(history, new Date("2026-04-07T00:00:00.000Z"))).toBe("todo");
    expect(stateAt(history, new Date("2026-04-09T00:00:00.000Z"))).toBe("in_progress");
  });

  it("include la transizione avvenuta esattamente in quell'istante", () => {
    expect(stateAt(history, new Date("2026-04-08T09:00:00.000Z"))).toBe("in_progress");
  });
});

describe("reopenCount", () => {
  it("conta ogni ritorno da done", () => {
    const history = [
      move(null, "todo", "2026-04-06T09:00:00.000Z"),
      move("todo", "done", "2026-04-07T09:00:00.000Z"),
      move("done", "in_progress", "2026-04-08T09:00:00.000Z"),
      move("in_progress", "done", "2026-04-09T09:00:00.000Z"),
      move("done", "in_progress", "2026-04-10T09:00:00.000Z"),
    ];

    // Due riaperture: un elemento riaperto tre volte è un segnale diverso da
    // uno riaperto una sola volta.
    expect(reopenCount(history)).toBe(2);
  });

  it("è zero per un elemento mai concluso", () => {
    expect(reopenCount([move(null, "todo", "2026-04-06T09:00:00.000Z")])).toBe(0);
  });
});

describe("cambio dell'ora legale", () => {
  it("misura il tempo reale trascorso, non le ore sull'orologio", () => {
    // In Europa l'ora legale è iniziata il 29 marzo 2026 alle 01:00 UTC.
    // Tutto è memorizzato in UTC (§7), quindi la durata deve essere di 24 ore
    // esatte: un calcolo su ore locali ne conterebbe 23.
    const history = [
      move(null, "todo", "2026-03-28T12:00:00.000Z"),
      move("todo", "in_progress", "2026-03-29T12:00:00.000Z"),
    ];

    const [first] = stateIntervals(history, ASOF);
    expect(first?.duration).toBe(24 * HOUR);
  });
});
