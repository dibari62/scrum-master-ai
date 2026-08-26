import { beforeEach, describe, expect, it } from "vitest";

import { rangeForecast, releasePlan } from "@/metrics";

import { item, resetIds, uuidFor } from "./builders";

/**
 * The example printed on page 100, transcribed exactly.
 *
 * The book's own table names the sprint each story lands in, so this is not a
 * fixture we invented to match the code: it is the published answer, and if the
 * engine disagrees with it the engine is wrong (ADR-0008).
 *
 * The last two rows carry **no estimate** in the book. That is not an omission
 * in the transcription — it is the book following its own advice, «Time-estimate
 * the most important items» — and it makes the example a better test than a
 * tidy one would have been.
 */
const BOOK_BACKLOG: readonly { readonly name: string; readonly points: number | null }[] = [
  { name: "banana", points: 12 },
  { name: "apple", points: 9 },
  { name: "orange", points: 20 },
  { name: "guava", points: 8 },
  { name: "pear", points: 20 },
  { name: "raisin", points: 12 },
  { name: "peanut", points: 10 },
  { name: "donut", points: 8 },
  { name: "onion", points: 10 },
  { name: "grapefruit", points: 14 },
  { name: "papaya", points: 4 },
  { name: "blueberry", points: null },
  { name: "peach", points: null },
];

function bookBacklog() {
  return BOOK_BACKLOG.map((entry, index) =>
    item({
      id: uuidFor(entry.name),
      title: entry.name,
      backlogOrder: index,
      estimate: entry.points === null ? null : { value: entry.points, unit: "points" },
    }),
  );
}

const names = (items: readonly { readonly title: string }[]) => items.map((i) => i.title);

describe("releasePlan — l'esempio del libro, velocity 45", () => {
  beforeEach(resetIds);

  it("riproduce gli sprint stampati a pagina 100", () => {
    const plan = releasePlan(bookBacklog(), 45);

    expect(names(plan.sprints[0]?.items ?? [])).toEqual(["banana", "apple", "orange"]);
    expect(names(plan.sprints[1]?.items ?? [])).toEqual(["guava", "pear", "raisin"]);
    expect(names(plan.sprints[2]?.items ?? [])).toEqual([
      "peanut",
      "donut",
      "onion",
      "grapefruit",
    ]);
    expect(names(plan.sprints[3]?.items ?? [])).toEqual(["papaya"]);
  });

  it("nessuno sprint supera la velocity stimata", () => {
    const plan = releasePlan(bookBacklog(), 45);

    expect(plan.sprints.map((sprint) => sprint.points)).toEqual([41, 40, 42, 4]);
    for (const sprint of plan.sprints) expect(sprint.points).toBeLessThanOrEqual(45);
  });

  it("servono tre sprint per obbligatori e attesi, come dice il testo", () => {
    /*
     * «Now we can see that we'll probably need **three sprints** to finish all
     * the "must haves" and "should haves"» (pag. 100).
     *
     * Nella figura il giallo arriva fino a `onion`, che cade nel terzo sprint.
     */
    const plan = releasePlan(bookBacklog(), 45);
    const throughOnion = plan.sprints.findIndex((sprint) =>
      sprint.items.some((entry) => entry.title === "onion"),
    );

    expect(throughOnion + 1).toBe(3);
  });

  it("gli elementi non stimati restano fuori dal piano, non contati come zero", () => {
    /*
     * Una storia da zero punti è gratis; una non stimata è ignota. Trattare la
     * seconda come la prima è il modo in cui un piano finisce per promettere
     * lavoro che nessuno ha dimensionato.
     */
    const plan = releasePlan(bookBacklog(), 45);

    expect(names(plan.unplannable)).toEqual(["blueberry", "peach"]);
    expect(plan.sprints.flatMap((sprint) => names(sprint.items))).not.toContain("blueberry");
  });
});

describe("releasePlan — casi limite", () => {
  beforeEach(resetIds);

  function sized(name: string, points: number, position: number) {
    return item({
      id: uuidFor(name),
      title: name,
      backlogOrder: position,
      estimate: { value: points, unit: "points" },
    });
  }

  it("non riordina il backlog per riempire meglio uno sprint", () => {
    /*
     * Con velocity 10 e la sequenza 8, 5, 2, un pianificatore «furbo» metterebbe
     * 8+2 nel primo sprint. Sarebbe una ri-prioritizzazione silenziosa: l'ordine
     * è la decisione del Product Owner, e migliorarlo significa cambiarla.
     */
    const plan = releasePlan([sized("otto", 8, 0), sized("cinque", 5, 1), sized("due", 2, 2)], 10);

    expect(names(plan.sprints[0]?.items ?? [])).toEqual(["otto"]);
    expect(names(plan.sprints[1]?.items ?? [])).toEqual(["cinque", "due"]);
  });

  it("una storia più grande di uno sprint ottiene uno sprint suo, dichiarato in sfondamento", () => {
    const plan = releasePlan([sized("enorme", 60, 0), sized("piccola", 5, 1)], 45);

    expect(names(plan.sprints[0]?.items ?? [])).toEqual(["enorme"]);
    expect(plan.sprints[0]?.overflows).toBe(true);
    expect(plan.sprints[0]?.points).toBe(60);

    // E non blocca il piano: ciò che segue viene comunque collocato.
    expect(names(plan.sprints[1]?.items ?? [])).toEqual(["piccola"]);
  });

  it("uno sprint che sta nei limiti non risulta in sfondamento", () => {
    const plan = releasePlan([sized("giusta", 45, 0)], 45);

    expect(plan.sprints[0]?.overflows).toBe(false);
  });

  it("una velocity non positiva non produce un piano, e lo dichiara", () => {
    /*
     * Restituire un piano vuoto sarebbe indistinguibile da un backlog vuoto.
     * Qui tutto resta non pianificabile, che è la verità: con velocity zero
     * nessuno sprint può contenere nulla.
     */
    const plan = releasePlan([sized("una", 5, 0)], 0);

    expect(plan.sprints).toEqual([]);
    expect(names(plan.unplannable)).toEqual(["una"]);
  });

  it("le stime in ore non si tagliano con una velocity in punti", () => {
    const plan = releasePlan(
      [item({ id: uuidFor("a ore"), title: "a ore", backlogOrder: 0, estimate: { value: 8, unit: "hours" } })],
      45,
    );

    expect(plan.sprints).toEqual([]);
    expect(names(plan.unplannable)).toEqual(["a ore"]);
  });

  it("un backlog vuoto dà un piano vuoto, non un errore", () => {
    expect(releasePlan([], 45)).toEqual({ sprints: [], unplannable: [], velocity: 45 });
  });

  it("gli sprint sono numerati da uno, come si leggono", () => {
    const plan = releasePlan([sized("a", 45, 0), sized("b", 45, 1)], 45);

    expect(plan.sprints.map((sprint) => sprint.number)).toEqual([1, 2]);
  });
});

describe("rangeForecast — All / Some / None", () => {
  beforeEach(resetIds);

  it("divide il backlog nelle tre liste del libro", () => {
    /*
     * «All: these will all be done even if our velocity is low (30). Some: some
     * of these will be done, but not all. None: none of these will be done,
     * even if our velocity is high (50).» (pag. 101)
     *
     * Su un solo sprint con l'esempio del libro:
     *   a 30 → banana(12) + apple(9) = 21; orange porterebbe a 41, fuori.
     *   a 50 → +orange(20) = 41, +guava(8) = 49; pear porterebbe a 69, fuori.
     *
     * Quindi «some» sono **due** storie, non una. Il conto a mano ne diceva
     * una: aveva torto il conto, e il test lo ha corretto prima che l'errore
     * finisse in una pagina.
     */
    const forecast = rangeForecast(bookBacklog(), { low: 30, high: 50 }, 1);

    expect(names(forecast.all.items)).toEqual(["banana", "apple"]);
    expect(names(forecast.some.items)).toEqual(["orange", "guava"]);
    expect(names(forecast.none.items).slice(0, 2)).toEqual(["pear", "raisin"]);
  });

  it("le tre liste sono una partizione: nessun elemento sta in due o in nessuna", () => {
    const forecast = rangeForecast(bookBacklog(), { low: 30, high: 50 }, 2);
    const total =
      forecast.all.items.length + forecast.some.items.length + forecast.none.items.length;

    expect(total).toBe(BOOK_BACKLOG.length);
  });

  it("estremi invertiti significano «fra questi due», non un errore", () => {
    const straight = rangeForecast(bookBacklog(), { low: 30, high: 50 }, 1);
    const flipped = rangeForecast(bookBacklog(), { low: 50, high: 30 }, 1);

    expect(names(flipped.all.items)).toEqual(names(straight.all.items));
    expect(flipped.low).toBe(30);
  });

  it("ciò che non è stimato non può essere promesso", () => {
    const forecast = rangeForecast(bookBacklog(), { low: 30, high: 50 }, 9);

    expect(names(forecast.none.items)).toContain("blueberry");
    expect(names(forecast.all.items)).not.toContain("blueberry");
  });

  it("con un intervallo di un solo valore «some» resta vuoto", () => {
    // Nessuna incertezza dichiarata, nessuna zona incerta da mostrare.
    const forecast = rangeForecast(bookBacklog(), { low: 45, high: 45 }, 1);

    expect(forecast.some.items).toEqual([]);
  });

  it("somma le stime di ciascuna lista, non solo gli elementi", () => {
    const forecast = rangeForecast(bookBacklog(), { low: 30, high: 50 }, 1);

    expect(forecast.all.total.points).toBe(21);
    // orange (20) + guava (8): le due storie che entrano solo a velocity alta.
    expect(forecast.some.total.points).toBe(28);
  });
});
