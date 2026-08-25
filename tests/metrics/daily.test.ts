import { beforeEach, describe, expect, it } from "vitest";

import type { StateTransition } from "@/domain";
import { dailyActivity, type DailyActivity, type Milliseconds } from "@/metrics";

import { DAY, expectAvailable, move, resetIds, uuidFor } from "./builders";

/**
 * What moved in a window, and what stood still.
 *
 * The half that is easy to get right is the movement. The half that matters is
 * the other one: an item standing still leaves no row behind, so it exists only
 * as the absence of one — and an absence is what a digest is most likely to get
 * quietly wrong.
 */

const FROM = new Date("2026-08-23T00:00:00.000Z");
const TO = new Date("2026-08-23T23:59:59.999Z");

function run(
  transitions: readonly StateTransition[],
  stalledAfterMs: Milliseconds | null = null,
) {
  return dailyActivity({ transitions, from: FROM, to: TO, stalledAfterMs });
}

const W1 = uuidFor("primo");
const W2 = uuidFor("secondo");

describe("attività di una giornata", () => {
  beforeEach(() => resetIds());

  it("conta ciò che è stato concluso dentro la finestra", () => {
    const value = expectAvailable<DailyActivity>(
      run([
        move("in_review", "done", "2026-08-23T10:00:00.000Z", { workItemId: W1 }),
        move("in_review", "done", "2026-08-22T10:00:00.000Z", { workItemId: W2 }),
      ]),
    );

    expect(value.finished).toEqual([W1]);
  });

  it("considera «iniziato» solo il primo ingresso in lavorazione", () => {
    /*
     * Un elemento che torna in lavorazione dopo una revisione si muove, ma non
     * comincia: contarlo gonfierebbe il digest proprio nei giorni di
     * rilavorazione, quando un resoconto ottimista inganna di più.
     */
    const value = expectAvailable<DailyActivity>(
      run([
        move("todo", "in_progress", "2026-08-20T09:00:00.000Z", { workItemId: W1 }),
        move("in_progress", "in_review", "2026-08-21T09:00:00.000Z", { workItemId: W1 }),
        move("in_review", "in_progress", "2026-08-23T09:00:00.000Z", { workItemId: W1 }),
      ]),
    );

    expect(value.started).toEqual([]);
    expect(value.movements).toBe(1);
  });

  it("registra una riapertura come tale, non come avanzamento", () => {
    const value = expectAvailable<DailyActivity>(
      run([
        move("in_review", "done", "2026-08-20T09:00:00.000Z", { workItemId: W1 }),
        move("done", "in_progress", "2026-08-23T09:00:00.000Z", { workItemId: W1 }),
      ]),
    );

    expect(value.reopened).toEqual([W1]);
    expect(value.finished).toEqual([]);
  });

  it("guarda lo stato alla fine della finestra, non l'ultimo conosciuto", () => {
    const value = expectAvailable<DailyActivity>(
      run([
        move("in_progress", "blocked", "2026-08-23T09:00:00.000Z", { workItemId: W1 }),
        move("blocked", "in_progress", "2026-08-25T09:00:00.000Z", { workItemId: W1 }),
      ]),
    );

    expect(value.blocked).toEqual([W1]);
  });

  it("un giorno senza movimenti è un fatto, non un'assenza di dati", () => {
    // «Ieri non si è mosso nulla» è precisamente ciò che un digest deve poter
    // dire: trasformarlo in «non disponibile» toglierebbe l'informazione più
    // preoccupante che esista.
    const value = expectAvailable<DailyActivity>(
      run([move("todo", "in_progress", "2026-08-01T09:00:00.000Z", { workItemId: W1 })]),
    );

    expect(value.movements).toBe(0);
  });

  it("non è disponibile senza alcuna storia degli stati", () => {
    const result = run([]);

    expect(result.available).toBe(false);
    expect(!result.available && result.reason).toBe("no-data");
  });

  it("rifiuta una finestra rovesciata invece di restituire il vuoto", () => {
    const result = dailyActivity({
      transitions: [
        move("todo", "in_progress", "2026-08-23T09:00:00.000Z", { workItemId: W1 }),
      ],
      from: TO,
      to: FROM,
      stalledAfterMs: null,
    });

    expect(result.available).toBe(false);
  });
});

describe("ciò che non si è mosso", () => {
  beforeEach(() => resetIds());

  it("nomina gli elementi aperti fermi oltre la soglia", () => {
    const value = expectAvailable<DailyActivity>(
      run(
        [move("todo", "in_progress", "2026-08-10T09:00:00.000Z", { workItemId: W1 })],
        (5 * DAY) as Milliseconds,
      ),
    );

    expect(value.stalled.map((entry) => entry.workItemId)).toEqual([W1]);
  });

  it("non considera fermo ciò che è concluso", () => {
    // Un elemento chiuso da un mese non è fermo: è finito. Confonderli
    // riempirebbe il digest di allarmi su lavoro che non esiste più.
    const value = expectAvailable<DailyActivity>(
      run(
        [
          move("todo", "in_progress", "2026-08-01T09:00:00.000Z", { workItemId: W1 }),
          move("in_progress", "done", "2026-08-02T09:00:00.000Z", { workItemId: W1 }),
        ],
        (5 * DAY) as Milliseconds,
      ),
    );

    expect(value.stalled).toEqual([]);
  });

  it("senza una soglia non inventa una definizione di «troppo»", () => {
    const value = expectAvailable<DailyActivity>(
      run([move("todo", "in_progress", "2026-01-01T09:00:00.000Z", { workItemId: W1 })], null),
    );

    expect(value.stalled).toEqual([]);
  });

  it("mette per primo l'elemento fermo da più tempo", () => {
    const value = expectAvailable<DailyActivity>(
      run(
        [
          move("todo", "in_progress", "2026-08-18T09:00:00.000Z", { workItemId: W1 }),
          move("todo", "in_progress", "2026-08-05T09:00:00.000Z", { workItemId: W2 }),
        ],
        (2 * DAY) as Milliseconds,
      ),
    );

    expect(value.stalled.map((entry) => entry.workItemId)).toEqual([W2, W1]);
  });
});
