import { describe, expect, it } from "vitest";

import { compareEstimateChanges, estimateAt, groupEstimateChanges } from "@/domain";

import { estimateChange } from "../metrics/builders";

const ITEM_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ITEM_B = "bbbbbbbb-0000-4000-8000-000000000002";

const POINTS = (value: number) => ({ value, unit: "points" as const });

/**
 * La storia delle stime.
 *
 * Esiste per lo stesso motivo di `StateTransition`: **una fotografia non
 * ricostruisce una storia**. `WorkItem.estimate` dice quanto vale oggi, e
 * leggerlo per calcolare la velocity significa che correggere una stima adesso
 * sposta la velocity di uno sprint chiuso tre settimane fa.
 */
describe("estimateAt", () => {
  const changes = [
    estimateChange(ITEM_A, null, POINTS(5), "2026-04-02T08:00:00.000Z"),
    estimateChange(ITEM_A, POINTS(5), POINTS(13), "2026-04-14T10:00:00.000Z"),
  ];

  it("restituisce la stima in vigore a quell'istante", () => {
    expect(estimateAt(changes, new Date("2026-04-10T00:00:00.000Z"))).toEqual(POINTS(5));
    expect(estimateAt(changes, new Date("2026-04-20T00:00:00.000Z"))).toEqual(POINTS(13));
  });

  it("prima della prima variazione non c'è stima, e non è zero", () => {
    /*
     * «Nessuno l'aveva ancora dimensionato» e «l'abbiamo dimensionato ed è
     * gratis» sono affermazioni diverse, e il libro le conta diversamente: una
     * storia non stimata non contribuisce alla velocity, una storia da zero
     * punti contribuisce zero.
     */
    expect(estimateAt(changes, new Date("2026-04-01T00:00:00.000Z"))).toBeNull();
  });

  it("una variazione esattamente all'istante richiesto è già in vigore", () => {
    /*
     * Il confine è inclusivo: una variazione registrata nell'istante esatto in
     * cui l'elemento entra nello sprint fa parte del piano che la squadra si è
     * presa, non di una revisione successiva.
     */
    expect(estimateAt(changes, new Date("2026-04-14T10:00:00.000Z"))).toEqual(POINTS(13));
  });

  it("una stima rimossa torna a essere assente", () => {
    const removed = [
      estimateChange(ITEM_A, null, POINTS(8), "2026-04-02T08:00:00.000Z"),
      estimateChange(ITEM_A, POINTS(8), null, "2026-04-06T08:00:00.000Z"),
    ];

    expect(estimateAt(removed, new Date("2026-04-10T00:00:00.000Z"))).toBeNull();
  });

  it("non si fida dell'ordine in cui arrivano le variazioni", () => {
    // Le righe tornano dal database nell'ordine che il database preferisce.
    // Una metrica che cambia fra due esecuzioni identiche è peggio di una
    // sbagliata: quella almeno si nota.
    const shuffled = [changes[1]!, changes[0]!];
    expect(estimateAt(shuffled, new Date("2026-04-10T00:00:00.000Z"))).toEqual(POINTS(5));
  });

  it("una storia vuota non ha stima", () => {
    expect(estimateAt([], new Date("2026-04-10T00:00:00.000Z"))).toBeNull();
  });
});

describe("compareEstimateChanges", () => {
  it("a parità di istante decide l'identificativo", () => {
    /*
     * Due variazioni possono condividere il timestamp: una modifica in blocco,
     * o una fonte con risoluzione al secondo. Senza un criterio di parità
     * l'ordine dipenderebbe da come tornano le righe.
     */
    const first = estimateChange(ITEM_A, null, POINTS(3), "2026-04-06T08:00:00.000Z");
    const second = estimateChange(ITEM_A, POINTS(3), POINTS(5), "2026-04-06T08:00:00.000Z");

    expect(compareEstimateChanges(first, second)).toBeLessThan(0);
    expect(estimateAt([second, first], new Date("2026-04-06T08:00:00.000Z"))).toEqual(POINTS(5));
  });
});

describe("groupEstimateChanges", () => {
  it("separa gli elementi e ordina ciascuna storia", () => {
    const grouped = groupEstimateChanges([
      estimateChange(ITEM_B, null, POINTS(2), "2026-04-08T08:00:00.000Z"),
      estimateChange(ITEM_A, POINTS(5), POINTS(13), "2026-04-14T10:00:00.000Z"),
      estimateChange(ITEM_A, null, POINTS(5), "2026-04-02T08:00:00.000Z"),
    ]);

    expect(grouped.size).toBe(2);
    expect(grouped.get(ITEM_A)?.map((change) => change.toEstimate?.value)).toEqual([5, 13]);
    expect(grouped.get(ITEM_B)?.map((change) => change.toEstimate?.value)).toEqual([2]);
  });
});
