import { describe, expect, it } from "vitest";

import { PRICING } from "@/lib/llm";

import {
  isKnownSkillKey,
  isSkillAvailable,
  llmProviderSchema,
  skillKeyReferenceSchema,
  skillKeySchema,
  skillRunFailureCauseSchema,
  skillRunStatusSchema,
  tokenBudgetSchema,
  triggerSchema,
  validSkillRunSchema,
} from "@/domain";

/**
 * Skills and the run register, against criteri 13, 25 and 28 of the spec.
 */

const IDS = {
  id: "1b4e28ba-2fa1-4d3b-a3f5-cc9f8d3a1b77",
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
  scrumAgentId: "5e8b1d47-9c2a-4f36-8b71-3d0a6e9f2c48",
};

function aRun(overrides: Record<string, unknown> = {}) {
  return {
    ...IDS,
    skillKey: "configuration-check",
    trigger: "on_demand",
    startedAt: new Date("2026-08-22T10:00:00Z"),
    finishedAt: new Date("2026-08-22T10:00:02Z"),
    durationMs: 2000,
    status: "succeeded",
    failureCause: null,
    provider: "fake",
    model: "fake-1",
    inputTokens: 120,
    outputTokens: 40,
    estimatedCostUsd: 0,
    createdAt: new Date("2026-08-22T10:00:02Z"),
    updatedAt: new Date("2026-08-22T10:00:02Z"),
    ...overrides,
  };
}

describe("catalogo delle skill", () => {
  it("dichiara eseguibile ogni capacità che è stata costruita", () => {
    /*
     * Dichiarare una skill serve al catalogo; renderla eseguibile è un'altra
     * decisione. Le sei sono passate da dichiarate a eseguibili una alla volta,
     * man mano che venivano costruite: `sprint-report` in T4, `sprint-health` con
     * la narrazione, poi collo di bottiglia, digest e domande sul progetto.
     */
    expect(isSkillAvailable("configuration-check")).toBe(true);
    expect(isSkillAvailable("sprint-report")).toBe(true);
    expect(isSkillAvailable("sprint-health")).toBe(true);
    expect(isSkillAvailable("bottleneck-detection")).toBe(true);
    expect(isSkillAvailable("daily-digest")).toBe(true);
    expect(isSkillAvailable("project-qa")).toBe(true);
  });

  it("dichiara eseguibile ogni capacità del catalogo", () => {
    /*
     * Il catalogo e ciò che il prodotto sa fare ora coincidono.
     *
     * Per buona parte della costruzione questo test verificava il contrario —
     * che «eseguibile» fosse un sottoinsieme **proprio** di «dichiarata» — e
     * quella era l'affermazione giusta finché c'erano capacità promesse e non
     * costruite. Ora tutte e sei esistono, e pretendere una lacuna significherebbe
     * chiedere al prodotto di restare incompleto per non far fallire un test.
     *
     * Ciò che resta difeso è il **meccanismo**: dichiarare una capacità e
     * renderla eseguibile restano due decisioni separate, e la seconda passa da
     * qui. Una settima capacità aggiunta all'enum senza essere costruita deve
     * poter essere rifiutata prima del gateway.
     */
    const eseguibili = skillKeySchema.options.filter(isSkillAvailable);

    expect(eseguibili).toEqual(skillKeySchema.options);
    expect(isSkillAvailable("project-qa")).toBe(true);
  });

  it("mantiene separate la dichiarazione e l'esecuzione", () => {
    // Una chiave che il catalogo non conosce non è eseguibile per definizione:
    // è la porta che impedisce a una capacità inventata di arrivare al gateway.
    expect(isKnownSkillKey("skill-inventata")).toBe(false);
  });

  it("rifiuta in ingresso una chiave che non esiste", () => {
    expect(skillKeySchema.safeParse("skill-inventata").success).toBe(false);
  });

  it("in lettura tollera una chiave ritirata, senza far fallire il caricamento", () => {
    /*
     * Caso limite della specifica: una chiave sparita dal catalogo in un
     * rilascio successivo va ignorata e segnalata, non deve impedire di
     * aprire la scheda dell'agente. Da qui due forme: chiusa in ingresso,
     * aperta in lettura.
     */
    expect(skillKeyReferenceSchema.safeParse("skill-ritirata").success).toBe(true);
    expect(isKnownSkillKey("skill-ritirata")).toBe(false);
    expect(isKnownSkillKey("configuration-check")).toBe(true);
  });
});

describe("insiemi chiusi del registro (criterio 13)", () => {
  it("gli esiti sono due e nessuno è ambiguo", () => {
    expect([...skillRunStatusSchema.options].sort()).toEqual(["failed", "succeeded"]);
  });

  it("le cause di fallimento sono quelle dichiarate dal glossario", () => {
    // Scritte a mano: aggiungerne una deve costringere a chiedersi se
    // l'interfaccia sappia spiegarla a chi la legge.
    expect([...skillRunFailureCauseSchema.options].sort()).toEqual([
      "agent_suspended",
      "budget_exceeded",
      "invalid_output",
      "provider_not_configured",
      "provider_unavailable",
      "quota_exceeded",
      "rate_limited",
      "timeout",
    ]);
  });

  it("i trigger sono tre, anche se in T3 ne funziona uno solo", () => {
    expect([...triggerSchema.options].sort()).toEqual(["event", "on_demand", "scheduled"]);
  });

  it("il fornitore fittizio esiste, e non è un ripiego", () => {
    /*
     * L'elenco cresce — con ADR-0010 la scelta è di chi usa il portale, non
     * nostra — quindi il test non lo enumera più: sarebbe una seconda copia
     * della stessa lista, da aggiornare a ogni fornitore aggiunto, cioè
     * esattamente ciò che R4 vieta.
     *
     * Ciò che deve restare vero è che `fake` c'è: è quello che permette a test
     * ed eval di girare senza rete e senza chiave.
     */
    expect(llmProviderSchema.options).toContain("fake");
  });

  it("ogni fornitore ha un prezzo dichiarato", () => {
    /*
     * `PRICING` è tipizzato `Record<LlmProvider, …>`, quindi il compilatore
     * costringe già a dichiararlo. Questo test difende la cosa che il
     * compilatore non vede: che la data di rilevazione sia scritta, così l'età
     * di una cifra è visibile invece che presunta.
     */
    for (const provider of llmProviderSchema.options) {
      expect(PRICING[provider].quotedOn.length, `${provider} senza data`).toBeGreaterThan(0);
    }
  });
});

describe("coerenza di un'esecuzione registrata", () => {
  it("accetta un'esecuzione riuscita", () => {
    expect(validSkillRunSchema.safeParse(aRun()).success).toBe(true);
  });

  it("pretende una causa quando l'esecuzione è fallita", () => {
    // «Fallito» senza causa non è diagnosticabile, e l'interfaccia deve poter
    // dire cosa fare.
    expect(
      validSkillRunSchema.safeParse(aRun({ status: "failed", failureCause: null })).success,
    ).toBe(false);

    expect(
      validSkillRunSchema.safeParse(aRun({ status: "failed", failureCause: "timeout" }))
        .success,
    ).toBe(true);
  });

  it("rifiuta una causa su un'esecuzione riuscita", () => {
    expect(
      validSkillRunSchema.safeParse(aRun({ status: "succeeded", failureCause: "timeout" }))
        .success,
    ).toBe(false);
  });

  it("rifiuta una fine che precede l'inizio", () => {
    expect(
      validSkillRunSchema.safeParse(
        aRun({
          startedAt: new Date("2026-08-22T10:00:05Z"),
          finishedAt: new Date("2026-08-22T10:00:00Z"),
        }),
      ).success,
    ).toBe(false);
  });

  it("registra zero token quando nessun fornitore è stato contattato (criterio 20)", () => {
    // Rifiutata dal budget: nessuna chiamata, quindi nessun token e nessun
    // costo, ma l'esecuzione esiste lo stesso nel registro.
    const rifiutata = aRun({
      status: "failed",
      failureCause: "budget_exceeded",
      provider: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    });

    expect(validSkillRunSchema.safeParse(rifiutata).success).toBe(true);
  });

  it("rifiuta conteggi di token negativi o non interi", () => {
    expect(validSkillRunSchema.safeParse(aRun({ inputTokens: -1 })).success).toBe(false);
    expect(validSkillRunSchema.safeParse(aRun({ outputTokens: 1.5 })).success).toBe(false);
  });

  it("rifiuta un costo negativo o non finito", () => {
    // Un costo non finito arriverebbe da una divisione per zero nel listino:
    // meglio un errore che un numero senza senso nel registro.
    expect(validSkillRunSchema.safeParse(aRun({ estimatedCostUsd: -0.01 })).success).toBe(
      false,
    );
    expect(
      validSkillRunSchema.safeParse(aRun({ estimatedCostUsd: Number.POSITIVE_INFINITY }))
        .success,
    ).toBe(false);
  });

  it.todo(
    "criterio 28: il costo viene calcolato dal listino versionato — arriva con il gateway",
  );
});

describe("budget di token", () => {
  it("rifiuta zero e valori negativi: un budget nullo non è un budget", () => {
    expect(tokenBudgetSchema.safeParse(0).success).toBe(false);
    expect(tokenBudgetSchema.safeParse(-100).success).toBe(false);
  });

  it("ha un tetto: un budget illimitato è un costo illimitato", () => {
    expect(tokenBudgetSchema.safeParse(1_000_000).success).toBe(false);
  });
});
