import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { generateSeedBatch } from "@/connectors/seed";
import { toWorkItemRow, workItemEstimate } from "@/db/rows";
import { workItems } from "@/db/schema";
import { organizationIdSchema, projectIdSchema, workItemSchema } from "@/domain";

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

function anItem(estimate: { value: number; unit: "points" | "hours" } | null) {
  return workItemSchema.parse({
    id: "7c2f1a44-9e33-4d21-8b0a-2f6c5d9e1a70",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    sourceSystem: "seed",
    sourceId: "item-1",
    kind: "story",
    title: "Salvataggio del carrello",
    description: null,
    state: "done",
    estimate,
    sprintId: null,
    assigneeId: null,
    parentId: null,
    sourceCreatedAt: new Date("2026-05-01T08:00:00Z"),
    createdAt: new Date("2026-05-01T08:00:00Z"),
    updatedAt: new Date("2026-05-09T15:00:00Z"),
  });
}

/**
 * These tests exist because of a real defect: the write path dropped `estimate`
 * silently, so every estimate in the database was null and the dashboard
 * reported "nessuna stima" for four sprints. Nothing failed — there was simply
 * no test on the conversion between the canonical model and a row.
 */
describe("conversione fra modello canonico e righe", () => {
  it("scrive la stima nelle due colonne separate", () => {
    const row = toWorkItemRow(anItem({ value: 5, unit: "points" }));

    expect(row.estimateValue).toBe(5);
    expect(row.estimateUnit).toBe("points");
  });

  it("distingue le unità invece di appiattirle su un numero", () => {
    expect(toWorkItemRow(anItem({ value: 4, unit: "hours" })).estimateUnit).toBe("hours");
  });

  it("lascia nulle entrambe le colonne quando la stima manca", () => {
    const row = toWorkItemRow(anItem(null));

    expect(row.estimateValue).toBeNull();
    expect(row.estimateUnit).toBeNull();
  });

  it("ricostruisce la stima leggendo le due colonne", () => {
    expect(workItemEstimate({ estimateValue: 8, estimateUnit: "points" })).toEqual({
      value: 8,
      unit: "points",
    });
  });

  it("tratta come assente mezza stima: un valore senza unità non è sommabile", () => {
    expect(workItemEstimate({ estimateValue: 8, estimateUnit: null })).toBeNull();
    expect(workItemEstimate({ estimateValue: null, estimateUnit: "points" })).toBeNull();
  });

  it("rifiuta un'unità che il dominio non conosce invece di indovinare", () => {
    expect(() => workItemEstimate({ estimateValue: 8, estimateUnit: "giorni" })).toThrow();
  });

  it("conserva la stima nell'andata e ritorno, per ogni elemento del seed", () => {
    const batch = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 42,
    });

    // Non un campione: l'errore riguardava tutte e 51 le righe.
    for (const item of batch.workItems) {
      expect(workItemEstimate(toWorkItemRow(item))).toEqual(item.estimate);
    }

    // E almeno una stima deve esserci davvero, altrimenti il ciclo qui sopra
    // passerebbe confrontando null con null — che è esattamente il difetto.
    expect(batch.workItems.some((item) => item.estimate !== null)).toBe(true);
  });

  it("riempie ogni colonna della tabella: una colonna nuova non resta a null", () => {
    const row = toWorkItemRow(anItem({ value: 3, unit: "points" }));

    expect(Object.keys(row).sort()).toEqual(Object.keys(getTableColumns(workItems)).sort());
  });
});
