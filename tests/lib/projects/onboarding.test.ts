import { describe, expect, it } from "vitest";

import { onboarding, onboardingFromSettings } from "@/lib/projects/onboarding";

/**
 * I primi passi di un progetto appena creato.
 *
 * La verifica che conta non è che l'elenco esista, ma **quando sparisce**: una
 * sezione «cosa fare» che resta accesa su un progetto configurato diventa
 * rumore, e il rumore si impara a ignorare insieme a tutto il resto.
 */

const SLUG = "portale-clienti";

const NUOVO = {
  slug: SLUG,
  connector: null,
  connectorConfigured: false,
  brainProvider: "fake" as const,
  brainKeyPresent: false,
  hasAgent: false,
};

describe("che cosa manca a un progetto", () => {
  it("un progetto appena creato è vuoto e ha un passo da fare", () => {
    const stato = onboarding(NUOVO);

    expect(stato.empty).toBe(true);
    expect(stato.steps.find((step) => step.id === "dati")?.done).toBe(false);
  });

  it("«nessun modello» conta come scelta fatta, non come passo mancante", () => {
    /*
     * `fake` non è un ripiego: i numeri restano veri, cambiano solo i testi che
     * li accompagnano. Segnarlo come «da fare» insisterebbe perché qualcuno
     * spenda soldi in una funzione che ha deciso di non usare — ed è il modo
     * più rapido per far ignorare l'intero elenco.
     */
    expect(onboarding(NUOVO).steps.find((step) => step.id === "modello")?.done).toBe(true);
  });

  it("un fornitore vero senza chiave resta da fare", () => {
    // Il solo caso incoerente: qualcuno ha scelto Gemini e non ha finito.
    const stato = onboarding({ ...NUOVO, brainProvider: "gemini" });

    expect(stato.steps.find((step) => step.id === "modello")?.done).toBe(false);
  });

  it("un fornitore che non chiede credenziali è già a posto", () => {
    // Ollama gira in casa: pretendere una chiave bloccherebbe l'unico fornitore
    // in cui i dati non lasciano l'azienda.
    const stato = onboarding({ ...NUOVO, brainProvider: "ollama" });

    expect(stato.steps.find((step) => step.id === "modello")?.done).toBe(true);
  });

  it("con tutto a posto non resta nulla, e la sezione sparisce", () => {
    const stato = onboarding({
      ...NUOVO,
      connector: "seed",
      connectorConfigured: true,
      hasAgent: true,
    });

    expect(stato.remaining).toBe(0);
    expect(stato.empty).toBe(false);
  });

  it("i dati collegati bastano a non essere più «vuoto»", () => {
    /*
     * La distinzione che decide quanto spazio dare all'elenco. Con i dati
     * collegati la dashboard è piena di numeri veri, e i passi rimasti sono un
     * suggerimento; senza, sono l'unica cosa che vale la pena leggere.
     */
    const stato = onboarding({ ...NUOVO, connector: "seed", connectorConfigured: true });

    expect(stato.empty).toBe(false);
    expect(stato.remaining).toBe(1);
  });

  it("una fonte scelta ma non configurata non conta", () => {
    // Scegliere «Jira» da un menu non collega nulla: senza indirizzo, board e
    // token non c'è niente da leggere, e dire «fatto» sarebbe una bugia che la
    // prima sincronizzazione smentisce.
    const stato = onboarding({ ...NUOVO, connector: "jira", connectorConfigured: false });

    expect(stato.empty).toBe(true);
  });

  it("ogni passo porta dove si fa la cosa", () => {
    // Un elenco che dice cosa manca senza portarci è un elenco che si legge una
    // volta sola.
    for (const step of onboarding(NUOVO).steps) {
      expect(step.href).toContain(SLUG);
    }
  });

  it("dice che cosa si guadagna, non che cosa si compila", () => {
    const dati = onboarding(NUOVO).steps.find((step) => step.id === "dati");

    expect(dati?.benefit).toContain("metriche");
  });

  it("il suggerimento sparisce quando il passo è fatto", () => {
    const fatto = onboarding({ ...NUOVO, connector: "seed", connectorConfigured: true });

    expect(fatto.steps.find((step) => step.id === "dati")?.hint).toBeNull();
  });
});

describe("lettura dalle impostazioni salvate", () => {
  it("un segreto presente conta senza essere letto", () => {
    /*
     * `connectorReady` chiede il segreto; qui basta sapere che esiste. Passare
     * un segnaposto invece del valore vero è ciò che permette a questa funzione
     * di lavorare su `SafeProjectSettings`, che i segreti non li contiene
     * affatto (§8.3).
     */
    const stato = onboardingFromSettings({
      slug: SLUG,
      connector: "jira",
      connectorConfig: { siteUrl: "https://esempio.atlassian.net" },
      connectorSecretConfigured: true,
      brainProvider: "fake",
      brainKeyConfigured: false,
      hasAgent: false,
    });

    expect(stato.empty).toBe(false);
  });

  it("senza segreto la fonte non è pronta", () => {
    const stato = onboardingFromSettings({
      slug: SLUG,
      connector: "jira",
      connectorConfig: { siteUrl: "https://esempio.atlassian.net" },
      connectorSecretConfigured: false,
      brainProvider: "fake",
      brainKeyConfigured: false,
      hasAgent: false,
    });

    expect(stato.empty).toBe(true);
  });

  it("i dati di esempio non chiedono nulla", () => {
    // `seed` genera i propri dati: pretendere una configurazione lo renderebbe
    // inutilizzabile proprio come modo per provare il portale.
    const stato = onboardingFromSettings({
      slug: SLUG,
      connector: "seed",
      connectorConfig: {},
      connectorSecretConfigured: false,
      brainProvider: "fake",
      brainKeyConfigured: false,
      hasAgent: false,
    });

    expect(stato.empty).toBe(false);
  });
});
