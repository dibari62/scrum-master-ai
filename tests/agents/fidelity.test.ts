import { describe, expect, it } from "vitest";

import type { CitableValue } from "@/domain";
import { checkNumericFidelity, normaliseNumber, numericTokens } from "@/agents/sprint-report";

/**
 * The check that turns R1 from an instruction into a property.
 *
 * These tests matter more than most in this repository. Everything else about
 * the sprint report can be wrong and produce a bad report; this being wrong
 * produces a *convincing* one, with a number nobody computed, in a document
 * somebody forwards to a stakeholder.
 *
 * The «scappatoie chiuse» block exists because a review found real ones. Every
 * case in it is a text that an earlier version of this module accepted.
 */

const VALUES: readonly CitableValue[] = [
  { metricId: "cycle-time", label: "Cycle time mediano", text: "2,8 giorni" },
  { metricId: "cycle-time", label: "Cycle time all'85°", text: "8,7 giorni" },
  { metricId: "velocity", label: "Velocity", text: "31 punti" },
  { metricId: "throughput", label: "Elementi conclusi", text: "44 elementi" },
  { metricId: "reopen-rate", label: "Tasso di riapertura", text: "11,4%" },
];

describe("normalizzazione dei numeri", () => {
  it.each([
    ["2,80", "2.8"],
    ["2.80", "2.8"],
    ["0,5", "0.5"],
    ["100", "100"],
    ["1,0", "1"],
    ["0", "0"],
    ["10,00", "10"],
    ["07", "7"],
  ])("%s diventa %s", (input, expected) => {
    expect(normaliseNumber(input)).toBe(expected);
  });

  it("legge le migliaia all'italiana invece di scambiarle per decimali", () => {
    // La versione precedente riduceva «1.000» al token «1»: era il modo in cui
    // mille elementi inventati passavano per il numero uno.
    expect(normaliseNumber("1.000")).toBe("1000");
    expect(normaliseNumber("10.000")).toBe("10000");
  });

  it("tiene distinti 1.234 e 1,234, che sono due quantità diverse", () => {
    expect(normaliseNumber("1.234")).toBe("1234");
    expect(normaliseNumber("1,234")).toBe("1.234");
  });

  it("il segno fa parte del numero", () => {
    expect(normaliseNumber("-31")).toBe("-31");
    expect(normaliseNumber("-31")).not.toBe(normaliseNumber("31"));
  });
});

describe("estrazione dei numeri", () => {
  it("trova interi e decimali con entrambi i separatori", () => {
    expect(numericTokens("2,8 giorni e 8.7 ore su 31")).toEqual(["2.8", "8.7", "31"]);
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
    const text =
      "Il cycle time mediano è stato di 2,8 giorni, in calo del 47% sullo sprint precedente.";

    const result = checkNumericFidelity(text, VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("47");
  });

  it("rifiuta una somma che il modello ha calcolato da sé", () => {
    // 2,8 e 8,7 sono entrambi legittimi. La loro somma non lo è: è esattamente
    // il comportamento che R1 vieta, e da solo non somiglia a un errore.
    const result = checkNumericFidelity("Fra avvio e chiusura sono passati 11,5 giorni.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("11,5");
  });

  it("rifiuta una percentuale arrotondata dal modello", () => {
    // «circa l'11%» sembra innocuo e non lo è: il modello ha arrotondato, cioè
    // ha fatto un calcolo, e il numero non coincide più con la dashboard.
    const result = checkNumericFidelity("Il tasso di riapertura è circa l'11%.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toEqual(["11"]);
  });

  it("accetta una percentuale scritta come nell'istantanea", () => {
    expect(checkNumericFidelity("Il tasso di riapertura è dell'11,4%.", VALUES)).toEqual({
      faithful: true,
    });
  });

  it("accetta «per cento» scritto a parole", () => {
    expect(checkNumericFidelity("Il tasso è dell'11,4 per cento.", VALUES)).toEqual({
      faithful: true,
    });
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

  it("accetta un testo senza numeri", () => {
    expect(checkNumericFidelity("Lo sprint si è chiuso senza sorprese.", VALUES)).toEqual({
      faithful: true,
    });
  });
});

describe("scappatoie chiuse", () => {
  it("senza valori citabili nessun numero passa, nemmeno piccolo", () => {
    // Il difetto peggiore emerso in revisione: la franchigia da 0 a 10
    // permetteva un report interamente inventato ma formalmente fedele.
    const result = checkNumericFidelity(
      "Il cycle time è 10 giorni, la velocity 9 punti e l'efficienza 8%.",
      [],
    );

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toHaveLength(3);
  });

  it("un conteggio piccolo va fornito dal codice, non dedotto dal modello", () => {
    expect(checkNumericFidelity("Restano aperti 3 elementi.", VALUES).faithful).toBe(false);

    const withCount: readonly CitableValue[] = [
      ...VALUES,
      { metricId: "carry-over", label: "Lavoro trascinato", text: "3 elementi" },
    ];

    expect(checkNumericFidelity("Restano aperti 3 elementi.", withCount)).toEqual({
      faithful: true,
    });
  });

  it("un numero non migra su un'unità che non ha mai avuto", () => {
    // 31 è la velocity, in punti. «31 giorni» è un'affermazione che nessuna
    // metrica sostiene, anche se il numero esiste da qualche parte.
    const result = checkNumericFidelity("Il cycle time è stato di 31 giorni.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("31 giorni");
  });

  it("una durata non diventa un punteggio", () => {
    expect(checkNumericFidelity("La velocity è stata di 2,8 punti.", VALUES).faithful).toBe(false);
  });

  it("il numero di un'etichetta non diventa una misura", () => {
    // «Cycle time all'85°» rendeva l'85 citabile ovunque, e una velocity di 85
    // punti passava senza che nulla l'avesse calcolata.
    const result = checkNumericFidelity("La velocity è stata di 85 punti.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("85");
  });

  it("le migliaia inventate non passano per il numero uno", () => {
    const result = checkNumericFidelity("Sono stati chiusi 1.000 elementi.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("1.000");
  });

  it("un numero rovesciato di segno è un numero diverso", () => {
    const result = checkNumericFidelity("La variazione è stata di -31 punti.", VALUES);

    expect(result.faithful).toBe(false);
    if (!result.faithful) expect(result.strangers).toContain("-31");
  });

  it.each([
    ["una frazione", "Il rapporto è 2/3."],
    ["un intervallo", "Serviranno 2-3 giorni."],
    ["un orario", "L'aggiornamento è alle 9:10."],
    ["una notazione esponenziale", "Il budget è 1e6."],
    ["una data", "Lo sprint si è chiuso il 23/08/2026."],
  ])("%s non passa più attraverso la franchigia dei numeri piccoli", (_name, text) => {
    expect(checkNumericFidelity(text, VALUES).faithful).toBe(false);
  });

  it("resta scoperto un numero scritto a parole, e lo dichiariamo", () => {
    // Limite noto, documentato in testa al modulo. Un buco dichiarato si può
    // affrontare; uno silenzioso no.
    expect(checkNumericFidelity("La velocity è stata di trentuno punti.", VALUES)).toEqual({
      faithful: true,
    });
  });
});

describe("nomi propri con una cifra dentro", () => {
  it("il nome dello sprint si può scrivere", () => {
    // «Sprint 4» è un nome, non una misura, e rifiutarlo respingerebbe report
    // corretti per via di una convenzione di denominazione.
    expect(
      checkNumericFidelity("Lo sprint 4 si è chiuso.", VALUES, ["Sprint 4 — Conferma d'ordine"]),
    ).toEqual({ faithful: true });
  });

  it("ma non si può usare come quantità", () => {
    const result = checkNumericFidelity("Sono serviti 4 giorni.", VALUES, ["Sprint 4"]);

    expect(result.faithful).toBe(false);
  });

  it("e non apre la porta agli altri numeri", () => {
    expect(checkNumericFidelity("Sono stati chiusi 47 elementi.", VALUES, ["Sprint 4"]).faithful)
      .toBe(false);
  });
});
