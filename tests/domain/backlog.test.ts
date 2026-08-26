import { describe, expect, it } from "vitest";

import { compareBacklogOrder, productBacklog, type WorkItem } from "@/domain";

import { item, uuidFor } from "../metrics/builders";

function placed(
  name: string,
  overrides: {
    readonly backlogOrder?: number | null;
    readonly sprintId?: string | null;
    readonly state?: WorkItem["state"];
    readonly sourceCreatedAt?: string;
  } = {},
): WorkItem {
  return item({
    id: uuidFor(name),
    title: name,
    backlogOrder: overrides.backlogOrder ?? null,
    sprintId: overrides.sprintId ?? null,
    state: overrides.state ?? "todo",
    ...(overrides.sourceCreatedAt === undefined
      ? {}
      : { sourceCreatedAt: overrides.sourceCreatedAt }),
  });
}

const titles = (items: readonly WorkItem[]): readonly string[] =>
  items.map((entry) => entry.title);

describe("ordine del backlog", () => {
  it("mette prima la posizione più bassa: è un ordine, non un punteggio", () => {
    const backlog = productBacklog([
      placed("terza", { backlogOrder: 2 }),
      placed("prima", { backlogOrder: 0 }),
      placed("seconda", { backlogOrder: 1 }),
    ]);

    expect(titles(backlog)).toEqual(["prima", "seconda", "terza"]);
  });

  it("un elemento non collocato va in fondo, non in cima", () => {
    /*
     * `null` è «non ancora collocato», non «meno importante».
     *
     * La distinzione conta perché il piano di rilascio taglia il backlog in
     * ordine: un elemento mai collocato che finisse in cima diventerebbe un
     * impegno che nessuno ha preso.
     */
    const backlog = productBacklog([
      placed("mai collocata", { backlogOrder: null }),
      placed("collocata", { backlogOrder: 9 }),
    ]);

    expect(titles(backlog)).toEqual(["collocata", "mai collocata"]);
  });

  it("a parità di posizione decide l'arrivo, poi l'identificativo", () => {
    /*
     * I duplicati sono possibili di proposito — non c'è un vincolo di unicità,
     * perché scambiare due elementi adiacenti richiederebbe un valore
     * temporaneo per aggirarlo.
     *
     * Il prezzo è questo pareggio, e va rotto in modo stabile: un comparatore
     * che lasciasse due elementi indistinti farebbe produrre allo stesso
     * backlog due piani di rilascio diversi in due esecuzioni. Un piano che
     * cambia quando non è cambiato nulla non è utilizzabile.
     */
    const backlog = productBacklog([
      placed("arrivata dopo", {
        backlogOrder: 3,
        sourceCreatedAt: "2026-05-02T08:00:00.000Z",
      }),
      placed("arrivata prima", {
        backlogOrder: 3,
        sourceCreatedAt: "2026-05-01T08:00:00.000Z",
      }),
    ]);

    expect(titles(backlog)).toEqual(["arrivata prima", "arrivata dopo"]);
  });

  it("ordina in modo stabile: due esecuzioni sullo stesso insieme danno la stessa lista", () => {
    const items = [
      placed("a", { backlogOrder: 1 }),
      placed("b", { backlogOrder: 1 }),
      placed("c", { backlogOrder: 1 }),
    ];

    expect(titles(productBacklog(items))).toEqual(titles(productBacklog([...items].reverse())));
  });

  it("non modifica l'insieme che riceve", () => {
    const items = [placed("seconda", { backlogOrder: 5 }), placed("prima", { backlogOrder: 1 })];
    const before = titles(items);

    productBacklog(items);

    expect(titles(items)).toEqual(before);
  });

  it("il confronto è coerente con sé stesso quando gli argomenti si invertono", () => {
    const a = placed("a", { backlogOrder: 1 });
    const b = placed("b", { backlogOrder: 4 });

    expect(Math.sign(compareBacklogOrder(a, b))).toBe(-Math.sign(compareBacklogOrder(b, a)));
    expect(compareBacklogOrder(a, a)).toBe(0);
  });
});

describe("che cosa è il backlog di prodotto", () => {
  it("esclude ciò che è già in uno sprint: non è più da pianificare", () => {
    const backlog = productBacklog([
      placed("in sprint", { backlogOrder: 0, sprintId: uuidFor("sprint") }),
      placed("da fare", { backlogOrder: 1 }),
    ]);

    expect(titles(backlog)).toEqual(["da fare"]);
  });

  it("esclude ciò che è concluso anche se non è mai stato in uno sprint", () => {
    /*
     * Il backlog è ciò che resta da pianificare.
     *
     * Un elemento già consegnato gonfierebbe ogni previsione di rilascio
     * costruita su questa lista, e lo farebbe in silenzio.
     */
    const backlog = productBacklog([
      placed("già fatta", { backlogOrder: 0, state: "done" }),
      placed("da fare", { backlogOrder: 1 }),
    ]);

    expect(titles(backlog)).toEqual(["da fare"]);
  });

  it("un elemento annullato resta fuori solo se il dominio lo dice concluso", () => {
    // `cancelled` non è `done`: è uscito dal flusso senza essere consegnato.
    // Il test dichiara il comportamento attuale invece di lasciarlo implicito.
    const backlog = productBacklog([placed("annullata", { backlogOrder: 0, state: "cancelled" })]);

    expect(titles(backlog)).toEqual(["annullata"]);
  });

  it("un insieme vuoto dà un backlog vuoto, non un errore", () => {
    expect(productBacklog([])).toEqual([]);
  });
});
