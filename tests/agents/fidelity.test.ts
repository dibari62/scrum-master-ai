import { describe, expect, it } from "vitest";

import type { CitableValue } from "@/domain";
import { checkNumericFidelity, numericTokens } from "@/agents/sprint-report";

/**
 * The check that turns R1 from an instruction into a property.
 *
 * These tests matter more than most in this repository. Everything else about
 * the sprint report can be wrong and produce a bad report; this being wrong
 * produces a *convincing* one, with a number nobody computed, in a document
 * somebody forwards to a stakeholder.
 */

const VALUES: readonly CitableValue[] = [
  { metricId: "cycle-time", label: "Cycle time mediano", text: "2,8 giorni" },
  { metricId: "cycle-time", label: "Cycle time all'85°", text: "8,7 giorni" },
  { metricId: "velocity", label: "Velocity", text: "31 punti" },
  { metricId: "reopen-rate", label: "Tasso di riapertura", text: "11,4%" },
];

describe("estrazione dei numeri", () => {
  it("trova interi e decimali con entrambi i separatori", () => {
    expect(numericTokens("2,8 giorni e 8.7 ore su 31")).toEqual(["2.8", "8.7", "31"]);
  });

  it("considera 2,80 e 2,8 lo stesso numero", () => {
    expect(numericTokens("2,80")).toEqual(numericTokens("2,8"));
  });

  it("non si fa ingannare dagli zeri iniziali", () => {
    expect(numericTokens("07")).toEqual(["7"]);
  });

  it("non trova numeri dove non ce ne sono", () => {
    expect(numericTokens("lo sprint è andato bene")).toEqual([]);
  });
});

describe("fedeltà numerica", () => {
  it("accetta un testo che cita solo numeri forniti dal codice", () => {
    const text =
      "Il cycle time mediano è stato di 2,8 giorni e la velocity di 31 punti. " +
      "La maggior parte degli elementi ha chiuso entro 8,7 giorni.";

    expect(checkNumericFidelity(text, VALUES)).toEqual({ faithful: true });
  });

  it("rifiuta un numero che nessuna metrica ha prodotto", () => {
    const text = "Il cycle time mediano è stato di 2,8 giorni, in calo del 47% sullo sprint precedente.";

    const result = checkNumericFidelity(text, VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("47");
  });

  it("rifiuta una somma che il modello ha calcolato da sé", () => {
    // 2,8 e 8,7 sono entrambi legittimi. La loro somma non lo è: è esattamente
    // il comportamento che R1 vieta, e da solo non somiglia a un errore.
    const text = "Fra avvio e chiusura sono passati in media 11,5 giorni.";

    const result = checkNumericFidelity(text, VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("11,5");
  });

  it("accetta i numeri piccoli della prosa ordinaria", () => {
    const text = "Restano aperti 3 elementi, di cui 2 in revisione.";

    expect(checkNumericFidelity(text, VALUES)).toEqual({ faithful: true });
  });

  it("rifiuta un numero grande anche se plausibile", () => {
    // La soglia dei piccoli interi si ferma a dieci proprio perché un numero
    // abbastanza grande da sembrare una misura non deve mai passare gratis.
    const text = "Sono stati chiusi 42 elementi.";

    const result = checkNumericFidelity(text, VALUES);

    expect(result.faithful).toBe(false);
  });

  it("accetta una percentuale scritta come nell'istantanea", () => {
    expect(checkNumericFidelity("Il tasso di riapertura è dell'11,4%.", VALUES)).toEqual({
      faithful: true,
    });
  });

  it("rifiuta una percentuale arrotondata dal modello", () => {
    // «circa l'11%» sembra innocuo e non lo è: il modello ha arrotondato, cioè
    // ha fatto un calcolo, e il numero non coincide più con la dashboard.
    const result = checkNumericFidelity("Il tasso di riapertura è circa l'11%.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toEqual(["11"]);
  });

  it("permette di nominare una metrica che ha un numero nel nome", () => {
    const text = "Il cycle time all'85° percentile è stato di 8,7 giorni.";

    expect(checkNumericFidelity(text, VALUES)).toEqual({ faithful: true });
  });

  it("elenca ogni intruso una volta sola", () => {
    const result = checkNumericFidelity("Prima 47, poi ancora 47 e infine 99.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toEqual(["47", "99"]);
  });

  it("senza valori citabili rifiuta qualunque misura", () => {
    const result = checkNumericFidelity("La velocity è stata di 31 punti.", []);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toEqual(["31"]);
  });

  it("accetta un testo senza numeri", () => {
    expect(checkNumericFidelity("Lo sprint si è chiuso senza sorprese.", VALUES)).toEqual({
      faithful: true,
    });
  });
});
