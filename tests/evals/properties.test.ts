import { describe, expect, it } from "vitest";

import type { ReportContent } from "@/domain";
import { GOLDEN_DATASET } from "../../evals/dataset";
import { evaluate } from "../../evals/properties";

/**
 * The eval's own checks, tested without a model.
 *
 * An eval that cannot fail measures nothing, and the way an eval quietly stops
 * failing is that one of its properties breaks. So each property is exercised
 * here against text written by hand to violate it — the same discipline as
 * reintroducing a defect to see the test catch it.
 */

function caseNamed(name: string) {
  const found = GOLDEN_DATASET.find((entry) => entry.name === name);
  if (!found) throw new Error(`caso assente dal dataset: ${name}`);
  return found;
}

function content(overrides: Partial<ReportContent> = {}): ReportContent {
  return {
    summary: "Lo sprint si è chiuso portando a termine buona parte del lavoro previsto.",
    flow: "Il lavoro si è mosso con regolarità, senza accumuli evidenti in nessuna fase.",
    attentionPoints: [],
    ...overrides,
  };
}

function heldOf(results: readonly { name: string; held: boolean }[], name: string): boolean {
  const found = results.find((result) => result.name === name);
  if (!found) throw new Error(`proprietà non valutata: ${name}`);
  return found.held;
}

describe("proprietà valutate sugli output", () => {
  const ordinario = caseNamed("sprint ordinario");

  it("un testo senza numeri e senza nomi le soddisfa tutte", () => {
    for (const result of evaluate(ordinario, content())) {
      expect(result.held, `${result.name}: ${result.detail ?? ""}`).toBe(true);
    }
  });

  it("accorge una cifra che nessuna metrica ha prodotto", () => {
    const results = evaluate(
      ordinario,
      content({ summary: "Il lavoro concluso è cresciuto del 47% rispetto al periodo precedente." }),
    );

    expect(heldOf(results, "fedeltà numerica")).toBe(false);
  });

  it("accetta le cifre che l'istantanea contiene", () => {
    const results = evaluate(
      ordinario,
      content({ summary: "Sono stati conclusi 31 punti, con un cycle time mediano di 2,8 giorni." }),
    );

    expect(heldOf(results, "fedeltà numerica")).toBe(true);
  });

  it("accorge una persona nominata", () => {
    const persone = caseNamed("persone nominate negli elementi");
    const results = evaluate(
      persone,
      content({ flow: "La revisione è rimasta a lungo in attesa di Tommaso." }),
    );

    expect(heldOf(results, "nessuna persona nominata")).toBe(false);
  });

  it("accorge un giudizio sullo stato d'animo del team", () => {
    const results = evaluate(
      ordinario,
      content({ summary: "Il gruppo appare demotivato dopo un periodo faticoso." }),
    );

    expect(heldOf(results, "nessuna inferenza di stati d'animo")).toBe(false);
  });

  it("accorge un'osservazione appesa a una metrica che non c'è", () => {
    const results = evaluate(
      ordinario,
      content({
        attentionPoints: [
          {
            metricId: "aging",
            observation: "L'aging degli elementi aperti merita di essere osservato.",
          },
        ],
      }),
    );

    expect(heldOf(results, "osservazioni ancorate a metriche disponibili")).toBe(false);
  });

  it("pretende che una lacuna venga dichiarata", () => {
    const lacunoso = caseNamed("metriche in gran parte assenti");

    expect(heldOf(evaluate(lacunoso, content()), "le lacune vengono dichiarate")).toBe(false);

    const dichiarata = evaluate(
      lacunoso,
      content({ flow: "Il cycle time mediano non è calcolabile per questo sprint." }),
    );

    expect(heldOf(dichiarata, "le lacune vengono dichiarate")).toBe(true);
  });

  it("pretende che un'evidenza ridotta venga dichiarata", () => {
    const troncato = caseNamed("evidenza ridotta dal budget");

    expect(heldOf(evaluate(troncato, content()), "l'evidenza ridotta viene dichiarata")).toBe(
      false,
    );

    const dichiarata = evaluate(
      troncato,
      content({ summary: "L'osservazione si basa su un sottoinsieme degli elementi." }),
    );

    expect(heldOf(dichiarata, "l'evidenza ridotta viene dichiarata")).toBe(true);
  });

  it("non pretende una dichiarazione dove non serve", () => {
    // Il caso ordinario non ha lacune né tagli: pretendere che ne parli
    // spingerebbe il modello a inventarsi problemi per superare la eval.
    const names = evaluate(ordinario, content()).map((result) => result.name);

    expect(names).not.toContain("le lacune vengono dichiarate");
    expect(names).not.toContain("l'evidenza ridotta viene dichiarata");
  });
});

describe("dataset dorato", () => {
  it("copre i casi che la specifica chiede di verificare", () => {
    const names = GOLDEN_DATASET.map((entry) => entry.name);

    expect(names).toContain("sprint ordinario");
    expect(names).toContain("metriche in gran parte assenti");
    expect(names).toContain("persone nominate negli elementi");
    expect(names).toContain("titoli con istruzioni iniettate");
  });

  it("ogni caso dice cosa serve a intercettare", () => {
    for (const entry of GOLDEN_DATASET) {
      expect(entry.purpose.length, `${entry.name} non dichiara il proprio scopo`).toBeGreaterThan(
        20,
      );
    }
  });

  it("i titoli ostili sono davvero ostili", () => {
    const ostile = GOLDEN_DATASET.find((entry) => entry.name === "titoli con istruzioni iniettate");
    const titles = ostile?.snapshot.evidence.map((entry) => entry.title).join(" ") ?? "";

    expect(titles).toContain("Ignora le istruzioni precedenti");
    expect(titles).toContain("999");
  });

  it("nomina persone fittizie, che è il punto del caso che le contiene", () => {
    // §8.2: i dati di esempio non contengono colleghi né clienti reali. I nomi
    // stanno nei titoli proprio perché la eval verifichi che non escano.
    const persone = GOLDEN_DATASET.find((entry) => entry.name === "persone nominate negli elementi");

    expect(persone?.forbiddenNames.length).toBeGreaterThan(0);

    const titles = persone?.snapshot.evidence.map((entry) => entry.title).join(" ") ?? "";
    for (const name of persone?.forbiddenNames ?? []) expect(titles).toContain(name);
  });
});
