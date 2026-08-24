import { beforeEach, describe, expect, it } from "vitest";

import { bottleneck } from "@/metrics";

import { DAY, HOUR, move, resetIds } from "./builders";

/**
 * Where the time goes, phase by phase.
 *
 * Two properties carry the whole metric, and neither is about arithmetic.
 *
 * The first is that **the bottleneck is never a phase where somebody is
 * working**. Picking the largest stage outright would frequently name
 * `in_progress`, which tells a team that the obstacle to finishing the work is
 * doing the work.
 *
 * The second is that **no waiting means no bottleneck**. Naming the least bad
 * phase anyway would promote a non-problem to a diagnosis, and a diagnosis that
 * is always positive stops being read.
 */

const ITEM_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ITEM_B = "bbbbbbbb-0000-4000-8000-000000000002";

const ASOF = new Date("2026-04-30T00:00:00.000Z");

beforeEach(() => resetIds());

function valueOf(result: ReturnType<typeof bottleneck>) {
  if (!result.available) throw new Error(`non disponibile: ${result.reason}`);
  return result.value;
}

describe("collo di bottiglia", () => {
  it("ripartisce il tempo fra le fasi attraversate", () => {
    // Un giorno in lavorazione, tre in revisione, poi chiuso.
    const transitions = [
      move(null, "todo", "2026-04-01T09:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));

    const review = result.stages.find((stage) => stage.state === "in_review");
    const working = result.stages.find((stage) => stage.state === "in_progress");

    expect(working?.totalMs).toBe(DAY);
    expect(review?.totalMs).toBe(3 * DAY);
  });

  it("le quote delle fasi sommano a uno", () => {
    // Criterio 2. Una somma diversa da uno significherebbe che del tempo è
    // stato contato due volte o perso, e nessuna singola percentuale lo
    // rivelerebbe.
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "blocked", "2026-04-05T09:00:00.000Z", { workItemId: ITEM_A }),
      move("blocked", "done", "2026-04-08T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));
    const sum = result.stages.reduce((total, stage) => total + stage.share, 0);

    expect(sum).toBeCloseTo(1, 10);
  });

  it("ordina le fasi da quella che assorbe più tempo", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-09T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));

    expect(result.stages[0]?.state).toBe("in_review");
    expect(result.stages[0]?.share).toBeGreaterThan(result.stages[1]?.share ?? 1);
  });

  it("non nomina mai come collo di bottiglia una fase di lavorazione", () => {
    /*
     * Criterio 4, ed è la proprietà che rende utile la metrica.
     *
     * Qui la lavorazione domina il tempo: prendere semplicemente la fase
     * maggiore direbbe alla squadra che l'ostacolo a finire il lavoro è fare
     * il lavoro.
     */
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-12T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-12T15:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));

    expect(result.stages[0]?.state).toBe("in_progress");
    expect(result.worstWait?.state).toBe("in_review");
    expect(result.worstWait?.valueAdding).toBe(false);
  });

  it("senza alcuna attesa non nomina alcun collo di bottiglia", () => {
    // Criterio 5: eleggere il male minore a problema è il modo in cui una
    // diagnosi sempre positiva smette di essere letta.
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-05T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));

    expect(result.worstWait).toBeNull();
    expect(result.valueAddingShare).toBeCloseTo(1, 10);
  });

  it("lascia fuori l'attesa prima della presa in carico", () => {
    /*
     * Questione Q1, decisa. Il tempo in backlog è attesa, ma è attesa prima
     * che la squadra prenda il lavoro: una scelta di priorità, non un
     * ingolfamento. Includerla farebbe risultare «da fare» il collo di
     * bottiglia di quasi ogni progetto — vero e inutile.
     */
    const transitions = [
      // Dieci giorni in backlog, poi un giorno di lavoro.
      move(null, "todo", "2026-04-01T09:00:00.000Z", { workItemId: ITEM_A }),
      move("todo", "in_progress", "2026-04-11T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-12T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));

    expect(result.stages.some((stage) => stage.state === "todo")).toBe(false);
    expect(result.stages[0]?.state).toBe("in_progress");
  });

  it("conta il tratto ancora in corso fino all'istante di riferimento", () => {
    // Criterio 7: un elemento fermo adesso è esattamente quello che interessa,
    // e ignorarlo lascerebbe fuori il caso peggiore.
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const asOf = new Date("2026-04-13T09:00:00.000Z");
    const result = valueOf(bottleneck(transitions, asOf));

    expect(result.worstWait?.state).toBe("in_review");
    expect(result.worstWait?.totalMs).toBe(10 * DAY);
  });

  it("somma i passaggi ripetuti nella stessa fase", () => {
    // La mediana è per passaggio e non per elemento: un elemento che torna in
    // revisione tre volte contribuisce tre volte, ed è proprio la ripetizione
    // che rende costosa la fase.
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "in_progress", "2026-04-04T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-05T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));
    const review = result.stages.find((stage) => stage.state === "in_review");

    expect(review?.totalMs).toBe(2 * DAY);
    // Un solo elemento, due passaggi.
    expect(review?.itemCount).toBe(1);
    if (!review?.medianMs.available) throw new Error("attesa una mediana");
    expect(review.medianMs.sampleSize).toBe(2);
  });

  it("aggrega più elementi nella stessa fase", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-04T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_B }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_B }),
      move("in_review", "done", "2026-04-05T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));
    const review = result.stages.find((stage) => stage.state === "in_review");

    expect(review?.itemCount).toBe(2);
    expect(review?.totalMs).toBe(3 * DAY);
  });

  it("non è disponibile senza alcuna storia di stati", () => {
    // Criterio 6: «non è mai stato avviato nulla» e «tutto è stato istantaneo»
    // sono affermazioni diverse, e una schermata di zeri le confonderebbe.
    expect(bottleneck([], ASOF).available).toBe(false);
  });

  it("non è disponibile se nessun elemento è mai stato preso in carico", () => {
    const transitions = [
      move(null, "todo", "2026-04-01T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = bottleneck(transitions, ASOF);
    expect(result.available).toBe(false);
  });

  it("dichiara su quanti elementi ha misurato", () => {
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "done", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move(null, "todo", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_B }),
    ];

    // Solo il primo è stato preso in carico: il secondo non entra nel campione.
    expect(bottleneck(transitions, ASOF).sampleSize).toBe(1);
  });

  it("dà lo stesso risultato due volte sugli stessi dati", () => {
    // Criterio 8: nessuna lettura dell'orologio, nessun ordine di iterazione
    // che cambi l'esito.
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const first = bottleneck(transitions, ASOF);
    const second = bottleneck(transitions, ASOF);

    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it("non espone alcun identificativo di persona", () => {
    /*
     * §8.2: una fase lenta è un fatto sul flusso, non su chi ci lavora. Il
     * modo naturale di «spiegare» una coda è dire chi ha in mano gli elementi
     * fermi, ed è esattamente ciò che questo prodotto si vieta.
     */
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "in_review", "2026-04-03T09:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const serialised = JSON.stringify(valueOf(bottleneck(transitions, ASOF)));

    expect(serialised).not.toMatch(/actor/i);
    expect(serialised).not.toMatch(/assignee/i);
    expect(serialised).not.toMatch(ITEM_A);
  });

  it("ignora i tratti di durata nulla invece di contarli come fasi", () => {
    // Due transizioni nello stesso istante non descrivono una permanenza:
    // creerebbero una fase da zero millisecondi e una riga in più da leggere.
    const transitions = [
      move(null, "in_progress", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_progress", "blocked", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("blocked", "in_review", "2026-04-02T09:00:00.000Z", { workItemId: ITEM_A }),
      move("in_review", "done", "2026-04-02T15:00:00.000Z", { workItemId: ITEM_A }),
    ];

    const result = valueOf(bottleneck(transitions, ASOF));

    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]?.state).toBe("in_review");
    expect(result.stages[0]?.totalMs).toBe(6 * HOUR);
  });
});
