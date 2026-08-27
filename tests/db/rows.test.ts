import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { generateSeedBatch } from "@/connectors/seed";
import {
  projectContextStructures,
  scrumAgentPolicy,
  toProjectContextRow,
  toScrumAgentRow,
  toSkillRunRow,
  toWorkItemRow,
  workItemEstimate,
} from "@/db/rows";
import { projectContexts, scrumAgents, skillRuns, workItems } from "@/db/schema";
import {
  organizationIdSchema,
  projectContextSchema,
  projectIdSchema,
  scrumAgentSchema,
  skillRunSchema,
  workItemSchema,
  UNSCHEDULED_CEREMONIES,
} from "@/domain";

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

/** Fixed: the generated data set must not change with the day the tests run. */
const ASOF = new Date("2026-08-19T10:00:00.000Z");

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
    backlogOrder: null,
    howToDemo: null,
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
      asOf: ASOF,
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

const AGENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const CONTEXT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const RUN_ID = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";

function anAgent(policy: { maxTokensPerRun: number | null; maxRunsPerDay: number }) {
  return scrumAgentSchema.parse({
    id: AGENT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    name: "Scrum Master di Checkout",
    persona: "facilitator",
    tone: "neutral",
    language: "it",
    autonomyLevel: "observe",
    status: "active",
    enabledSkillKeys: ["configuration-check"],
    policy,
    createdAt: new Date("2026-05-01T08:00:00Z"),
    updatedAt: new Date("2026-05-01T08:00:00Z"),
  });
}

/**
 * Lo stesso difetto di `estimate`, un traguardo più tardi: `policy` è un
 * oggetto canonico su due colonne, e `max_tokens_per_run` è annullabile — quindi
 * facoltativa in scrittura. Senza questi test, un mappatore che la dimentica
 * scrive «nessun tetto dichiarato» su ogni agente e nulla fallisce.
 */
describe("conversione dello ScrumAgent", () => {
  it("scrive la policy nelle due colonne separate", () => {
    const row = toScrumAgentRow(anAgent({ maxTokensPerRun: 4_000, maxRunsPerDay: 20 }));

    expect(row.maxTokensPerRun).toBe(4_000);
    expect(row.maxRunsPerDay).toBe(20);
  });

  it("conserva «non ridurre» come null e non come zero", () => {
    const row = toScrumAgentRow(anAgent({ maxTokensPerRun: null, maxRunsPerDay: 50 }));

    expect(row.maxTokensPerRun).toBeNull();
  });

  it("ricostruisce la policy nell'andata e ritorno", () => {
    const policy = { maxTokensPerRun: 1_500, maxRunsPerDay: 7 };

    expect(scrumAgentPolicy(toScrumAgentRow(anAgent(policy)))).toEqual(policy);
  });

  it("rifiuta un tetto giornaliero che il dominio non ammette", () => {
    expect(() => scrumAgentPolicy({ maxTokensPerRun: null, maxRunsPerDay: 0 })).toThrow();
  });

  it("riempie ogni colonna della tabella", () => {
    const row = toScrumAgentRow(anAgent({ maxTokensPerRun: null, maxRunsPerDay: 50 }));

    expect(Object.keys(row).sort()).toEqual(
      Object.keys(getTableColumns(scrumAgents)).sort(),
    );
  });
});

describe("conversione del ProjectContext", () => {
  const context = projectContextSchema.parse({
    id: CONTEXT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    sprintLengthDays: 14,
    ceremonies: {
      ...UNSCHEDULED_CEREMONIES,
      daily_scrum: { dayOfWeek: "monday", timeOfDay: "09:30" },
    },
    definitionOfDone: ["Test verdi", "Revisione approvata"],
    definitionOfReady: ["Stima concordata", "Come si dimostra scritto"],
    estimationScale: "planning-poker",
    workingCalendar: { workingDays: ["monday", "tuesday"], holidays: ["2026-08-15"] },
    acceptanceThresholds: { must: 3, should: 2, later: 1 },
    workingAgreement: null,
    stakeholders: [{ role: "Direzione commerciale", audience: "stakeholder" }],
    createdAt: new Date("2026-05-01T08:00:00Z"),
    updatedAt: new Date("2026-05-01T08:00:00Z"),
  });

  it("riempie ogni colonna della tabella", () => {
    expect(Object.keys(toProjectContextRow(context)).sort()).toEqual(
      Object.keys(getTableColumns(projectContexts)).sort(),
    );
  });

  it("conserva le strutture annidate nell'andata e ritorno", () => {
    const row = toProjectContextRow(context);

    expect(projectContextStructures(row)).toEqual({
      ceremonies: context.ceremonies,
      definitionOfDone: context.definitionOfDone,
      definitionOfReady: context.definitionOfReady,
      stakeholders: context.stakeholders,
      acceptanceThresholds: context.acceptanceThresholds,
    });
  });

  it("distingue «non pianificata» da «non risposta»: la cerimonia c'è, vale null", () => {
    const structures = projectContextStructures(toProjectContextRow(context));

    expect(structures.ceremonies.sprint_planning).toBeNull();
    expect(structures.ceremonies.daily_scrum).toEqual({
      dayOfWeek: "monday",
      timeOfDay: "09:30",
    });
  });

  /**
   * Il prezzo della scelta di `jsonb`: la colonna accetta qualunque JSON, e
   * `$type<...>()` è una dichiarazione, non un controllo. La verifica avviene
   * qui, in lettura, una volta sola.
   */
  it("rifiuta un pubblico che il dominio non conosce invece di propagarlo", () => {
    expect(() =>
      projectContextStructures({
        ceremonies: UNSCHEDULED_CEREMONIES,
        definitionOfDone: [],
        definitionOfReady: [],
        stakeholders: [{ role: "Direzione", audience: "consiglio-di-amministrazione" }],
        acceptanceThresholds: null,
      }),
    ).toThrow();
  });

  it("rifiuta soglie di accettazione con una fascia negativa", () => {
    // Un impegno contrattuale calcolato su una regola impossibile è peggio di
    // un impegno assente: sembra una risposta.
    expect(() =>
      projectContextStructures({
        ceremonies: UNSCHEDULED_CEREMONIES,
        definitionOfDone: [],
        definitionOfReady: [],
        stakeholders: [],
        acceptanceThresholds: { must: -1, should: 2, later: 0 },
      }),
    ).toThrow();
  });

  it("legge una colonna mai valorizzata come «soglie non dichiarate»", () => {
    /*
     * Una colonna aggiunta a una tabella già popolata vale `NULL` sulle righe
     * esistenti. È esattamente il significato voluto — nessuno ha ancora
     * tracciato la linea — e va letto come tale, non come un errore.
     */
    const structures = projectContextStructures({
      ceremonies: UNSCHEDULED_CEREMONIES,
      definitionOfDone: [],
      definitionOfReady: [],
      stakeholders: [],
      acceptanceThresholds: null,
    });

    expect(structures.acceptanceThresholds).toBeNull();
  });
});

describe("conversione dello SkillRun", () => {
  it("riempie ogni colonna, comprese quelle annullabili", () => {
    const run = skillRunSchema.parse({
      id: RUN_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      scrumAgentId: AGENT_ID,
      skillKey: "configuration-check",
      trigger: "on_demand",
      startedAt: new Date("2026-05-02T10:00:00Z"),
      finishedAt: new Date("2026-05-02T10:00:02Z"),
      durationMs: 2_000,
      status: "succeeded",
      failureCause: null,
      provider: "fake",
      model: "fake-1",
      inputTokens: 120,
      outputTokens: 45,
      estimatedCostUsd: 0,
      createdAt: new Date("2026-05-02T10:00:02Z"),
      updatedAt: new Date("2026-05-02T10:00:02Z"),
    });

    const row = toSkillRunRow(run);

    expect(Object.keys(row).sort()).toEqual(Object.keys(getTableColumns(skillRuns)).sort());
    // Il fornitore che ha servito davvero l'esecuzione: se il mappatore lo
    // dimenticasse, il registro direbbe «nessun fornitore contattato».
    expect(row.provider).toBe("fake");
    expect(row.model).toBe("fake-1");
  });
});
