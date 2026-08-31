import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_GEMINI_MODEL, COMPATIBLE_PROFILES } from "@/lib/llm";

/**
 * Il nome del modello predefinito, scritto in tre posti.
 *
 * **Il difetto che questo file blocca, e che è già successo.** Il predefinito
 * di Gemini viveva in `google.ts`, nel testo che spiega il fornitore e nel
 * segnaposto del campo «Modello». Quando Google ha smesso di offrire
 * `gemini-2.0-flash`, chi non aveva scelto nulla otteneva un rifiuto — e la
 * schermata continuava a suggerire con sicurezza il nome sbagliato.
 *
 * Le tre copie non si possono unificare importando la costante: quel modulo è
 * un componente client, e tirarsi dietro il gateway per una stringa
 * significherebbe spedire al browser codice che non gli serve. Il rimedio
 * praticabile è **verificare che coincidano**, leggendo il sorgente — lo stesso
 * metodo già usato per accertarsi che i segreti non vengano letti da un
 * letterale.
 */

const FORM = readFileSync(
  new URL("../../../src/app/progetti/[slug]/impostazioni/settings-form.tsx", import.meta.url),
  "utf8",
);

describe("i modelli predefiniti che la schermata annuncia", () => {
  it("annuncia per Gemini lo stesso nome che l'adattatore userà", () => {
    /*
     * Due copie nello stesso file: la frase che spiega il fornitore e il
     * segnaposto del campo. Si controllano insieme perché divergono insieme.
     *
     * Due esclusioni, entrambe necessarie. Il punto fermo di fine frase non fa
     * parte del nome. E un nome preceduto da uno slash è un **esempio di
     * sintassi OpenRouter** («fornitore/modello»), non un predefinito nostro:
     * pretendere che coincida vieterebbe di mostrare un esempio.
     */
    const occorrenze = FORM.match(/(?<!\/)\bgemini-[\w-]+(?:\.\d+)?[\w-]*/g) ?? [];
    const nostri = occorrenze.map((name) => name.replace(/\.$/, ""));

    expect(nostri.length).toBeGreaterThan(0);

    for (const name of nostri) {
      expect(name).toBe(DEFAULT_GEMINI_MODEL);
    }
  });

  it("annuncia per i fornitori compatibili i nomi che l'adattatore userà", () => {
    // Cinque fornitori, cinque predefiniti, e nessuno di essi è scritto in un
    // posto solo finché la schermata li nomina per invogliare a lasciarli vuoti.
    for (const [provider, profile] of Object.entries(COMPATIBLE_PROFILES)) {
      if (!FORM.includes(`${provider}:`)) continue;

      expect(FORM).toContain(profile.defaultModel);
    }
  });

  it("nomina un modello Anthropic solo se è quello predefinito", () => {
    // Stessa esclusione: «anthropic/claude-…» è un esempio di come si scrive un
    // modello su OpenRouter, non una promessa su cosa userà il portale.
    const occorrenze = FORM.match(/(?<!\/)\bclaude-[\w-]+(?:\.\d+)?[\w-]*/g) ?? [];

    for (const name of occorrenze) {
      expect(name.replace(/\.$/, "")).toBe(DEFAULT_ANTHROPIC_MODEL);
    }
  });
});
