import { describe, expect, it } from "vitest";

import { presentBurndown } from "@/app/progetti/present";

/**
 * Quale serie disegna un burndown, e in quale unità.
 *
 * **Il difetto che questo file chiude era silenzioso.** Le due pagine scrivevano
 * `remaining.points ?? 0`: su uno sprint senza stime in punti il grafico non
 * spariva, disegnava **una linea piatta a zero** — uno sprint che sembra
 * concluso il primo giorno. Nessun test falliva, perché nessun numero era
 * sbagliato: mancava soltanto, e l'assenza veniva resa come zero.
 *
 * Il libro prevede il caso e dà la risposta:
 *
 * > «If you don't have time estimates on the tasks, you can still do a burndown
 * > — **just count the tasks instead of adding up the hours**» (pag. 66)
 */

const AT = (day: number) => new Date(`2026-04-${String(day).padStart(2, "0")}T08:00:00.000Z`);

function point(day: number, points: number | null, hours: number | null, open: number) {
  return {
    at: AT(day),
    remaining: { points, hours },
    openCount: open,
    ideal: points,
  };
}

describe("un burndown con le stime", () => {
  it("disegna i punti e li chiama punti", () => {
    const drawn = presentBurndown({
      points: [point(6, 36, null, 12), point(7, 33, null, 11), point(8, 28, null, 9)],
    });

    expect(drawn.unitLabel).toBe("punti");
    expect(drawn.counted).toBe(false);
    expect(drawn.series.map((entry) => entry.remaining)).toEqual([36, 33, 28]);
  });

  it("disegna le ore quando la squadra stima in ore", () => {
    // Il libro usa le ore; il portale non deve avere un'opinione su quale unità
    // sia quella giusta.
    const drawn = presentBurndown({
      points: [point(6, null, 80, 12), point(7, null, 64, 10)],
    });

    expect(drawn.unitLabel).toBe("ore");
    expect(drawn.series.map((entry) => entry.remaining)).toEqual([80, 64]);
  });
});

describe("un burndown senza stime", () => {
  const senzaStime = {
    points: [
      { at: AT(6), remaining: { points: null, hours: null }, openCount: 12, ideal: null },
      { at: AT(7), remaining: { points: null, hours: null }, openCount: 9, ideal: null },
      { at: AT(8), remaining: { points: null, hours: null }, openCount: 5, ideal: null },
    ],
  };

  it("conta gli elementi invece di disegnare una linea piatta a zero", () => {
    /*
     * **La verifica che giustifica l'intero file.**
     *
     * `?? 0` non produceva «nessun grafico»: produceva uno sprint concluso il
     * primo giorno. È peggio dell'assenza, perché ha l'aspetto di
     * un'informazione.
     */
    const drawn = presentBurndown(senzaStime);

    expect(drawn.series.map((entry) => entry.remaining)).toEqual([12, 9, 5]);
    expect(drawn.series.every((entry) => entry.remaining === 0)).toBe(false);
  });

  it("lo dichiara, invece di lasciarlo indovinare", () => {
    // Un grafico che scende da 12 a 5 senza dire che conta elementi verrebbe
    // letto come punti, e il confronto con lo sprint precedente sarebbe fra due
    // unità diverse.
    const drawn = presentBurndown(senzaStime);

    expect(drawn.counted).toBe(true);
    expect(drawn.unitLabel).toBe("elementi");
  });

  it("la linea ideale parte dal numero di elementi, non da un punto inesistente", () => {
    /*
     * `ideal` è calcolato in punti e qui è `null`. Usarlo lascerebbe il grafico
     * senza guida proprio nel caso in cui la guida serve di più: un conteggio
     * non ha una scala che chi guarda già conosce.
     */
    const drawn = presentBurndown(senzaStime);

    expect(drawn.committed).toBe(12);
  });
});

describe("i casi limite", () => {
  it("un burndown senza punti non esplode", () => {
    const drawn = presentBurndown({ points: [] });

    expect(drawn.series).toEqual([]);
    expect(drawn.committed).toBe(0);
  });

  it("zero elementi aperti è un conteggio, non un'assenza", () => {
    // Uno sprint finito il primo giorno esiste, ed è diverso da uno sprint di
    // cui non si sa nulla. Qui la linea piatta a zero è **vera**.
    const drawn = presentBurndown({
      points: [
        { at: AT(6), remaining: { points: null, hours: null }, openCount: 0, ideal: null },
      ],
    });

    expect(drawn.counted).toBe(true);
    expect(drawn.series[0]?.remaining).toBe(0);
  });
});
