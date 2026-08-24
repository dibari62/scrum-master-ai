import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { METRIC_CATALOG } from "@/metrics/catalog";
import * as metrics from "@/metrics";

/**
 * Whether the catalogue still describes the engine.
 *
 * A page that explains a calculation is a second copy of that calculation, and
 * copies drift. Everything here exists to make the drift fail a build instead
 * of misinforming a reader: the catalogue is worth less than nothing if it is
 * confidently out of date.
 *
 * Reading the sources with `fs` is fine here — this is a test, not the engine,
 * and the no-I/O rule applies to `src/metrics` itself.
 */

const ENGINE_DIR = join(process.cwd(), "src", "metrics");

/**
 * Exports that are plumbing rather than metrics.
 *
 * Explicit, and each with its reason, because the alternative — a heuristic on
 * the name — would quietly let a real metric slip through as soon as one was
 * called something unexpected. Adding an entry here is a decision someone has
 * to write down.
 */
const NOT_METRICS: Readonly<Record<string, string>> = {
  // Shapes and constants, not calculations.
  EMPTY_TOTALS: "costante",
  METRIC_CATALOG: "il catalogo stesso",
  // Costruttori del risultato di una metrica.
  available: "costruisce un risultato disponibile",
  unavailable: "costruisce un risultato indisponibile, con la ragione",
  // Primitive statistiche, usate dalle metriche ma non mostrate da sole.
  mean: "primitiva statistica",
  median: "primitiva statistica",
  percentile: "primitiva statistica",
  // History plumbing: they prepare the data the metrics read.
  normaliseHistory: "prepara la storia, non misura",
  stateIntervals: "scompone la storia in tratti",
  timeInState: "primitiva usata dalle metriche di durata",
  valueAddingTime: "primitiva dell'efficienza di flusso",
  totalValueAddingTime: "la stessa primitiva, esposta grezza",
  firstEntryInto: "ricerca nella storia",
  lastEntryInto: "ricerca nella storia",
  stateAt: "ricerca nella storia",
  groupByWorkItem: "raggruppamento",
  reopenCount: "conteggio grezzo dietro il tasso di riapertura",
  // Aggregation and estimates.
  summariseDurations: "riassume una distribuzione già calcolata",
  summariseFlow: "aggrega le metriche di flusso ed è documentato come tasso di riapertura",
  totalEstimates: "somma le stime per unità, dietro velocity e carry-over",
  hasNoEstimates: "predicato di comodo",
  membershipAt: "composizione dello sprint a un istante",
};

function exportedFunctionNames(): readonly string[] {
  return Object.entries(metrics)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);
}

describe("catalogo delle metriche", () => {
  it("descrive ogni metrica esportata dal motore", () => {
    const documented = new Set(METRIC_CATALOG.map((entry) => entry.sourceSymbol));

    const undocumented = exportedFunctionNames().filter(
      (name) => !documented.has(name) && !(name in NOT_METRICS),
    );

    expect(
      undocumented,
      `metriche esportate senza una voce nel catalogo: ${undocumented.join(", ")}. ` +
        "Aggiungere una voce in src/metrics/catalog.ts, oppure dichiararle plumbing in NOT_METRICS con la ragione.",
    ).toEqual([]);
  });

  it("non descrive metriche che non esistono più", () => {
    const exported = new Set(Object.keys(metrics));

    const orphans = METRIC_CATALOG.filter((entry) => !exported.has(entry.sourceSymbol)).map(
      (entry) => `${entry.id} → ${entry.sourceSymbol}`,
    );

    expect(orphans, `voci che puntano a codice inesistente: ${orphans.join(", ")}`).toEqual([]);
  });

  it("cita file di codice e di test che esistono davvero", () => {
    const missing: string[] = [];

    for (const entry of METRIC_CATALOG) {
      for (const path of [entry.sourceFile, entry.testFile]) {
        if (!existsSync(join(process.cwd(), path))) missing.push(`${entry.id} → ${path}`);
      }
    }

    expect(missing, `riferimenti a file inesistenti: ${missing.join(", ")}`).toEqual([]);
  });

  it("cita, in ogni file, il simbolo che dichiara di contenere", () => {
    const wrong: string[] = [];

    for (const entry of METRIC_CATALOG) {
      const source = readFileSync(join(process.cwd(), entry.sourceFile), "utf8");
      if (!source.includes(`export function ${entry.sourceSymbol}`)) {
        wrong.push(`${entry.sourceSymbol} non è in ${entry.sourceFile}`);
      }
    }

    expect(wrong, wrong.join("; ")).toEqual([]);
  });

  it("copre ogni file del motore che contiene metriche", () => {
    const covered = new Set(METRIC_CATALOG.map((entry) => entry.sourceFile));

    // `result`, `history`, `estimates` e `catalog` non contengono metriche
    // rivolte al lettore: sono tipi, primitive e il catalogo stesso.
    const withMetrics = readdirSync(ENGINE_DIR)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => `src/metrics/${file}`)
      .filter((path) => !path.match(/(result|history|estimates|catalog|index)\.ts$/));

    for (const path of withMetrics) {
      expect(covered.has(path), `nessuna metrica del catalogo viene da ${path}`).toBe(true);
    }
  });

  it("usa identificativi distinti", () => {
    const ids = METRIC_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dice sempre cosa esclude e quando non è calcolabile", () => {
    // Un'esclusione non dichiarata è il modo più comune di fraintendere una
    // metrica: si dà per contato qualcosa che è deliberatamente fuori.
    for (const entry of METRIC_CATALOG) {
      expect(entry.excludes.length, `${entry.id} non dichiara cosa esclude`).toBeGreaterThan(0);
      expect(entry.unavailableWhen.length, `${entry.id} non dice quando è indisponibile`).
        toBeGreaterThan(0);
    }
  });

  it("lega ogni caso limite dichiarato a un test che esiste davvero", () => {
    /*
     * È il controllo che tiene in piedi tutti gli altri.
     *
     * `edgeCases` promette un comportamento in una situazione scomoda — «senza
     * variazioni di perimetro non risponde zero» — e una promessa sul
     * comportamento è esattamente ciò che va alla deriva per primo: il codice
     * cambia, la frase resta, e il lettore riceve una certezza sbagliata invece
     * di un dubbio onesto.
     *
     * Qui ogni promessa deve indicare il titolo di un test presente nel file
     * che la voce dichiara come proprio. Se qualcuno rinomina o cancella quel
     * test, la promessa resta senza prova e questa verifica cade.
     */
    const orphans: string[] = [];

    for (const entry of METRIC_CATALOG) {
      const testSource = readFileSync(join(process.cwd(), entry.testFile), "utf8");

      for (const edgeCase of entry.edgeCases) {
        if (!testSource.includes(edgeCase.verifiedBy)) {
          orphans.push(`${entry.id} → «${edgeCase.verifiedBy}» non è in ${entry.testFile}`);
        }
      }
    }

    expect(orphans, orphans.join("; ")).toEqual([]);
  });

  it("dichiara, per ogni metrica, entità lette e istante di riferimento", () => {
    /*
     * Il legame fra ciò che il catalogo dichiara di leggere e ciò che la
     * funzione riceve davvero.
     *
     * Una voce che dichiara di leggere `Sprint` mentre la funzione non prende
     * uno sprint descrive un'altra metrica. Il controllo è volutamente grezzo —
     * guarda i tipi nella firma, non l'uso — perché un controllo grezzo che
     * fallisce quando la firma cambia vale più di un'analisi raffinata che
     * nessuno mantiene.
     */
    const wrong: string[] = [];

    for (const entry of METRIC_CATALOG) {
      const source = readFileSync(join(process.cwd(), entry.sourceFile), "utf8");
      const start = source.indexOf(`export function ${entry.sourceSymbol}(`);
      const signature = source.slice(start, source.indexOf("{", start));

      for (const input of entry.inputs) {
        if (!signature.includes(input.entity)) {
          wrong.push(
            `${entry.id} dichiara di leggere ${input.entity}, ma ${entry.sourceSymbol} non lo riceve`,
          );
        }
      }

      // `asOf`, `instant`, `from`/`to`: se la firma prende un istante, il
      // catalogo deve dire da dove arriva. Mai dall'orologio (ADR-0002).
      const takesInstant = /:\s*Date/.test(signature);
      if (takesInstant && entry.referenceInstant === null) {
        wrong.push(
          `${entry.id}: ${entry.sourceSymbol} riceve un istante, ma il catalogo dichiara di non averne bisogno`,
        );
      }
    }

    expect(wrong, wrong.join("; ")).toEqual([]);
  });
});
