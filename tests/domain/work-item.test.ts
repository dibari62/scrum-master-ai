import { describe, expect, it } from "vitest";

import {
  estimateSchema,
  isActiveState,
  isCompletedState,
  isTerminalState,
  workItemSchema,
  workItemStateSchema,
  type WorkItemState,
} from "@/domain";

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";
const WORK_ITEM_ID = "1b4e28ba-2fa1-4d3b-a3f5-cc9f8d3a1b77";

const AUDIT = {
  createdAt: "2026-03-01T08:00:00.000Z",
  updatedAt: "2026-03-02T08:00:00.000Z",
} as const;

const WORK_ITEM = {
  id: WORK_ITEM_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  sourceSystem: "seed",
  sourceId: "SEED-1",
  kind: "story",
  title: "Rifare il flusso di pagamento",
  description: null,
  state: "in_progress",
  estimate: { value: 5, unit: "points" },
  sprintId: null,
  assigneeId: null,
  sourceCreatedAt: "2026-03-01T08:00:00.000Z",
  parentId: null,
  ...AUDIT,
} as const;

describe("classificazione degli stati", () => {
  it.each([
    ["todo", false],
    ["in_progress", true],
    ["in_review", true],
    ["blocked", false],
    ["done", false],
    ["cancelled", false],
  ] as ReadonlyArray<readonly [WorkItemState, boolean]>)(
    "%s è attivo: %s",
    (state, expected) => {
      expect(isActiveState(state)).toBe(expected);
    },
  );

  it("blocked non è attivo: un item fermo non è lavoro in corso", () => {
    // Contarlo come attivo farebbe sembrare occupata una squadra bloccata,
    // e gonfierebbe l'efficienza di flusso proprio quando peggiora.
    expect(isActiveState("blocked")).toBe(false);
  });

  it.each([
    ["done", true],
    ["cancelled", true],
    ["todo", false],
    ["in_review", false],
  ] as ReadonlyArray<readonly [WorkItemState, boolean]>)(
    "%s è terminale: %s",
    (state, expected) => {
      expect(isTerminalState(state)).toBe(expected);
    },
  );

  it("cancelled è terminale ma non è completamento", () => {
    // Conteggiarlo come completato premierebbe il lavoro abbandonato
    // gonfiando la velocity.
    expect(isTerminalState("cancelled")).toBe(true);
    expect(isCompletedState("cancelled")).toBe(false);
  });

  it("copre tutti gli stati dichiarati nello schema", () => {
    // Se qualcuno aggiunge uno stato senza classificarlo, questo test lo
    // segnala invece di lasciarlo silenziosamente inattivo e non terminale.
    for (const state of workItemStateSchema.options) {
      const classified =
        isActiveState(state) || isTerminalState(state) || state === "todo" || state === "blocked";
      expect(classified, `stato non classificato: ${state}`).toBe(true);
    }
  });
});

describe("estimateSchema", () => {
  it("richiede sempre l'unità", () => {
    expect(estimateSchema.safeParse({ value: 5 }).success).toBe(false);
  });

  it("rifiuta un'unità inventata", () => {
    expect(estimateSchema.safeParse({ value: 5, unit: "giorni" }).success).toBe(false);
  });

  it("accetta lo zero, che è diverso da assenza di stima", () => {
    expect(estimateSchema.parse({ value: 0, unit: "points" }).value).toBe(0);
  });

  it("rifiuta un valore negativo", () => {
    expect(estimateSchema.safeParse({ value: -1, unit: "points" }).success).toBe(false);
  });

  it("rifiuta un valore non finito", () => {
    expect(estimateSchema.safeParse({ value: Infinity, unit: "hours" }).success).toBe(false);
  });
});

describe("workItemSchema", () => {
  it("accetta un item completo", () => {
    const item = workItemSchema.parse(WORK_ITEM);
    expect(item.kind).toBe("story");
    expect(item.sourceCreatedAt).toBeInstanceOf(Date);
  });

  it("ammette un item di backlog senza sprint", () => {
    expect(workItemSchema.parse({ ...WORK_ITEM, sprintId: null }).sprintId).toBeNull();
  });

  it("ammette un item senza stima: non tutte le squadre stimano tutto", () => {
    expect(workItemSchema.parse({ ...WORK_ITEM, estimate: null }).estimate).toBeNull();
  });

  it("richiede l'identità di origine su ogni item", () => {
    const { sourceSystem: _system, ...senzaSistema } = WORK_ITEM;
    expect(workItemSchema.safeParse(senzaSistema).success).toBe(false);

    const { sourceId: _id, ...senzaIdentificativo } = WORK_ITEM;
    expect(workItemSchema.safeParse(senzaIdentificativo).success).toBe(false);
  });

  it("richiede sempre l'organizzazione", () => {
    const { organizationId: _org, ...senzaTenant } = WORK_ITEM;
    expect(workItemSchema.safeParse(senzaTenant).success).toBe(false);
  });

  it("rifiuta un sistema di origine sconosciuto", () => {
    expect(workItemSchema.safeParse({ ...WORK_ITEM, sourceSystem: "trello" }).success).toBe(
      false,
    );
  });

  it("rifiuta un tipo fuori dall'enumerazione", () => {
    expect(workItemSchema.safeParse({ ...WORK_ITEM, kind: "chore" }).success).toBe(false);
  });
});
