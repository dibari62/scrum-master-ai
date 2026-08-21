import { describe, expect, it } from "vitest";

import {
  compareTransitions,
  findHistoryDefects,
  stateTransitionSchema,
  type StateTransition,
  type WorkItemState,
} from "@/domain";

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";
const WORK_ITEM_ID = "1b4e28ba-2fa1-4d3b-a3f5-cc9f8d3a1b77";

const AUDIT = {
  createdAt: "2026-03-01T08:00:00.000Z",
  updatedAt: "2026-03-01T08:00:00.000Z",
} as const;

/** Builds a transition with a deterministic identifier derived from `index`. */
function transition(
  index: number,
  fromState: WorkItemState | null,
  toState: WorkItemState,
  occurredAt: string,
): StateTransition {
  return stateTransitionSchema.parse({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    sourceSystem: "seed",
    sourceId: `SEED-T${index}`,
    workItemId: WORK_ITEM_ID,
    fromState,
    toState,
    occurredAt,
    actorId: null,
    ...AUDIT,
  });
}

const HISTORY: readonly StateTransition[] = [
  transition(1, null, "todo", "2026-03-01T09:00:00.000Z"),
  transition(2, "todo", "in_progress", "2026-03-02T09:00:00.000Z"),
  transition(3, "in_progress", "in_review", "2026-03-03T09:00:00.000Z"),
  transition(4, "in_review", "done", "2026-03-04T09:00:00.000Z"),
];

describe("stateTransitionSchema", () => {
  it("ammette fromState nullo per la nascita dell'item", () => {
    expect(HISTORY[0]?.fromState).toBeNull();
  });

  it("richiede uno stato di destinazione canonico", () => {
    expect(() => transition(9, "todo", "in-progress" as WorkItemState, "2026-03-02T09:00:00.000Z")).toThrow();
  });
});

describe("compareTransitions", () => {
  it("ordina dalla più vecchia alla più recente", () => {
    const shuffled = [HISTORY[3]!, HISTORY[0]!, HISTORY[2]!, HISTORY[1]!];
    const ordered = [...shuffled].sort(compareTransitions);

    expect(ordered.map((t) => t.toState)).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "done",
    ]);
  });

  it("a parità di istante usa l'identificativo, così l'ordine è riproducibile", () => {
    // Una modifica in blocco produce timestamp identici. Senza criterio di
    // spareggio l'ordine dipenderebbe da come il database restituisce le righe,
    // e una metrica che cambia fra due esecuzioni identiche è peggio di una
    // semplicemente sbagliata.
    const sameInstant = "2026-03-05T09:00:00.000Z";
    const a = transition(10, "todo", "in_progress", sameInstant);
    const b = transition(11, "in_progress", "in_review", sameInstant);

    expect([b, a].sort(compareTransitions)).toEqual([a, b]);
    expect([a, b].sort(compareTransitions)).toEqual([a, b]);
  });
});

describe("findHistoryDefects", () => {
  it("non trova difetti in una storia coerente", () => {
    expect(findHistoryDefects(HISTORY)).toEqual([]);
  });

  it("accetta una storia vuota: un item può non avere ancora transizioni", () => {
    expect(findHistoryDefects([])).toEqual([]);
  });

  it("valuta la storia indipendentemente dall'ordine ricevuto", () => {
    const shuffled = [HISTORY[2]!, HISTORY[0]!, HISTORY[3]!, HISTORY[1]!];
    expect(findHistoryDefects(shuffled)).toEqual([]);
  });

  it("segnala una prima transizione che non parte dal nulla", () => {
    const defects = findHistoryDefects([
      transition(1, "todo", "in_progress", "2026-03-01T09:00:00.000Z"),
    ]);

    expect(defects.join(" ")).toContain("prima transizione");
  });

  it("segnala una catena interrotta", () => {
    // done → todo senza passare da nessun altro stato: il salto è reale, ma
    // qui la transizione dichiara di partire da in_review mentre lo stato
    // precedente era done.
    const defects = findHistoryDefects([
      transition(1, null, "todo", "2026-03-01T09:00:00.000Z"),
      transition(2, "todo", "done", "2026-03-02T09:00:00.000Z"),
      transition(3, "in_review", "todo", "2026-03-03T09:00:00.000Z"),
    ]);

    expect(defects.some((d) => d.includes("stato precedente"))).toBe(true);
  });

  it("segnala una transizione che non cambia stato", () => {
    const defects = findHistoryDefects([
      transition(1, null, "todo", "2026-03-01T09:00:00.000Z"),
      transition(2, "todo", "todo", "2026-03-02T09:00:00.000Z"),
    ]);

    expect(defects.some((d) => d.includes("stato invariato"))).toBe(true);
  });

  it("accetta una riapertura: done → in_progress è legittimo", () => {
    // Un item riaperto non è un difetto della storia: è il dato che alimenta
    // il tasso di riapertura.
    const defects = findHistoryDefects([
      transition(1, null, "todo", "2026-03-01T09:00:00.000Z"),
      transition(2, "todo", "done", "2026-03-02T09:00:00.000Z"),
      transition(3, "done", "in_progress", "2026-03-03T09:00:00.000Z"),
      transition(4, "in_progress", "done", "2026-03-04T09:00:00.000Z"),
    ]);

    expect(defects).toEqual([]);
  });
});
