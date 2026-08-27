import { beforeEach, describe, expect, it } from "vitest";

import { readinessCheck, READINESS_REQUIREMENTS } from "@/metrics";

import { item, resetIds, uuidFor } from "./builders";

function story(
  name: string,
  overrides: {
    readonly estimate?: { value: number; unit: "points" | "hours" } | null;
    readonly howToDemo?: string | null;
    readonly backlogOrder?: number | null;
  } = {},
) {
  return item({
    id: uuidFor(name),
    title: name,
    estimate:
      overrides.estimate === undefined ? { value: 3, unit: "points" } : overrides.estimate,
    howToDemo: overrides.howToDemo === undefined ? "Fai questo, poi quello." : overrides.howToDemo,
    backlogOrder: overrides.backlogOrder === undefined ? 0 : overrides.backlogOrder,
  });
}

describe("readinessCheck", () => {
  beforeEach(resetIds);

  it("controlla i tre campi che il libro nomina", () => {
    // «The simplest technique is simply to make sure that all the fields are
    // filled in for each story» (cap. 4, 2ª ed.).
    expect([...READINESS_REQUIREMENTS].sort()).toEqual([
      "backlog-position",
      "estimate",
      "how-to-demo",
    ]);
  });

  it("una storia con tutti i campi è pronta", () => {
    const result = readinessCheck([story("completa")], 1);

    expect(result.ready).toBe(1);
    expect(result.notReady).toEqual([]);
  });

  it("una storia senza stima non è pronta, ed è l'esempio del libro", () => {
    /*
     * > «This story named "Add user", there is no estimate for that. Let's
     * > estimate!»
     *
     * È il caso che il libro racconta per spiegare la Definition of Ready.
     */
    const result = readinessCheck([story("Add user", { estimate: null })], 1);

    expect(result.ready).toBe(0);
    expect(result.notReady[0]?.missing).toEqual(["estimate"]);
  });

  it("elenca tutto ciò che manca, non solo la prima cosa", () => {
    // Dire «manca la stima» a chi deve anche scrivere come si dimostra
    // costringe a due passaggi per un lavoro solo.
    const result = readinessCheck(
      [story("grezza", { estimate: null, howToDemo: null, backlogOrder: null })],
      1,
    );

    expect(result.notReady[0]?.missing).toEqual([
      "estimate",
      "how-to-demo",
      "backlog-position",
    ]);
  });

  it("guarda solo la cima del backlog, non tutto", () => {
    /*
     * «for each story that has high enough importance to be considered for
     * this sprint». Segnalare un intero backlog produrrebbe avvisi su cui
     * nessuno può agire, e un avviso inagibile insegna a saltare gli avvisi.
     */
    const backlog = [
      story("prima"),
      story("seconda"),
      story("lontana", { estimate: null }),
    ];

    const result = readinessCheck(backlog, 2);

    expect(result.considered).toBe(2);
    expect(result.notReady).toEqual([]);
  });

  it("una profondità maggiore del backlog guarda ciò che c'è, senza errori", () => {
    const result = readinessCheck([story("unica")], 99);

    expect(result.considered).toBe(1);
  });

  it("una profondità di zero non considera nulla, e lo dice", () => {
    const result = readinessCheck([story("prima", { estimate: null })], 0);

    expect(result.considered).toBe(0);
    expect(result.ready).toBe(0);
    expect(result.notReady).toEqual([]);
  });

  it("una profondità negativa si comporta come zero invece di leggere all'indietro", () => {
    expect(readinessCheck([story("prima")], -3).considered).toBe(0);
  });

  it("conserva l'ordine del backlog nell'elenco di ciò che non è pronto", () => {
    const result = readinessCheck(
      [story("a", { estimate: null }), story("b"), story("c", { howToDemo: null })],
      3,
    );

    expect(result.notReady.map((entry) => entry.title)).toEqual(["a", "c"]);
  });

  it("un backlog vuoto non è un errore", () => {
    expect(readinessCheck([], 5)).toEqual({ considered: 0, ready: 0, notReady: [] });
  });
});
