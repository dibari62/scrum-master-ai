import { beforeEach, describe, expect, it } from "vitest";

import { estimationScaleConformance } from "@/metrics";

import { item, resetIds, uuidFor } from "./builders";

/*
 * `id` deve essere un UUID: `item` lo passa a `workItemSchema`, che lo valida.
 * `uuidFor` produce un UUID stabile da un nome leggibile, così un fallimento
 * dice quale elemento e non quale cifra esadecimale.
 */
function sized(name: string, value: number, unit: "points" | "hours" = "points") {
  return item({ id: uuidFor(name), title: name, estimate: { value, unit } });
}

describe("estimationScaleConformance", () => {
  beforeEach(resetIds);

  it("senza scala dichiarata non riporta alcuna deviazione", () => {
    const result = estimationScaleConformance([sized("sette", 7)], "free");

    expect(result.offScale).toEqual([]);
    /*
     * Zero considerate, non una.
     *
     * La scala «libera» non giudica: dire «una considerata, zero fuori scala»
     * suggerirebbe una conformità del 100%, cioè una promessa su una regola che
     * la squadra non ha mai adottato.
     */
    expect(result.considered).toBe(0);
  });

  it("un 7 sul planning poker viene segnalato fra 5 e 8", () => {
    const result = estimationScaleConformance([sized("sette", 7)], "planning-poker");

    expect(result.considered).toBe(1);
    expect(result.offScale).toHaveLength(1);
    expect(result.offScale[0]?.value).toBe(7);
    expect(result.offScale[0]?.title).toBe("sette");
    expect(result.offScale[0]?.neighbours).toEqual({ below: 5, above: 8 });
  });

  it("sopra la carta più grande non inventa un valore superiore", () => {
    const result = estimationScaleConformance([sized("enorme", 150)], "planning-poker");

    expect(result.offScale).toHaveLength(1);
    expect(result.offScale[0]?.neighbours).toBeNull();
  });

  it("il 20 sta sul planning poker ma non sulla Fibonacci", () => {
    const items = [sized("venti", 20)];

    expect(estimationScaleConformance(items, "planning-poker").offScale).toEqual([]);
    expect(estimationScaleConformance(items, "fibonacci").offScale).toHaveLength(1);
  });

  it("il mezzo punto è la carta più piccola e viene ammesso", () => {
    const result = estimationScaleConformance([sized("mezzo", 0.5)], "planning-poker");

    expect(result.considered).toBe(1);
    expect(result.offScale).toEqual([]);
  });

  it("le stime in ore restano fuori dal conteggio, non fra le deviazioni", () => {
    const result = estimationScaleConformance(
      [sized("sette ore", 7, "hours")],
      "planning-poker",
    );

    expect(result.considered).toBe(0);
    expect(result.offScale).toEqual([]);
  });

  it("un elemento senza stima non entra nel denominatore", () => {
    const result = estimationScaleConformance(
      [item({ id: uuidFor("spike"), estimate: null }), sized("tre", 3)],
      "planning-poker",
    );

    expect(result.considered).toBe(1);
    expect(result.offScale).toEqual([]);
  });

  it("conserva l'ordine di ingresso, così due esecuzioni danno la stessa lista", () => {
    const result = estimationScaleConformance(
      [sized("sei", 6), sized("tre", 3), sized("sette", 7)],
      "planning-poker",
    );

    expect(result.offScale.map((deviation) => deviation.title)).toEqual(["sei", "sette"]);
  });

  it("un insieme vuoto non è un errore: nessuna stima da giudicare", () => {
    const result = estimationScaleConformance([], "planning-poker");

    expect(result).toEqual({ scale: "planning-poker", considered: 0, offScale: [] });
  });
});
