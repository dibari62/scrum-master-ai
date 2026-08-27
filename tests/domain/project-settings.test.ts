import { describe, expect, it } from "vitest";

import {
  brainReady,
  connectorReady,
  projectSettingsSchema,
  sealedSecretSchema,
  updateProjectSettingsInputSchema,
  UNCONFIGURED_SETTINGS,
} from "@/domain";
import { seal } from "@/lib/secrets";

import { randomBytes } from "node:crypto";

/**
 * Le impostazioni di un progetto: da dove prende i dati e con quale modello li
 * racconta.
 *
 * Le verifiche che contano riguardano tutte la stessa cosa — che un segreto in
 * chiaro non possa entrare in una colonna — e i tre stati di un campo segreto in
 * un modulo, che è il punto in cui si perde una chiave per distrazione.
 */

const ENV = { SECRETS_KEY: randomBytes(32).toString("base64") };

const SCOPE = {
  id: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  organizationId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
  projectId: "5c9e7b21-3f4a-4d68-9b17-2e8c6a0f4d33",
} as const;

function settings(overrides: Record<string, unknown> = {}) {
  return projectSettingsSchema.parse({
    ...SCOPE,
    ...UNCONFIGURED_SETTINGS,
    createdAt: "2026-08-27T09:00:00.000Z",
    updatedAt: "2026-08-27T09:00:00.000Z",
    ...overrides,
  });
}

describe("un segreto in chiaro non entra nel modello", () => {
  it("rifiuta una chiave API scritta com'è", () => {
    /*
     * **La verifica che giustifica l'esistenza di `sealedSecretSchema`.**
     *
     * Una colonna tipizzata `string` accetterebbe questo valore, e nulla
     * protesterebbe fino al giorno in cui qualcuno legge un backup. Qui lo
     * schema rifiuta, e il vincolo sul database rifiuta di nuovo: due difese,
     * perché la prima può essere aggirata da una query scritta a mano.
     */
    expect(() =>
      settings({ brainApiKey: "AIzaSyD-una-chiave-vera-incollata-qui" }),
    ).toThrow(/cifrato/);
  });

  it("accetta un segreto già cifrato", () => {
    const sealed = seal("AIzaSyD-una-chiave-vera", ENV);

    expect(() => settings({ brainApiKey: sealed, brainApiKeyUpdatedAt: new Date() })).not.toThrow();
  });

  it("riconosce la forma e non il contenuto", () => {
    // Lo schema non decifra: sa dire «questo è stato cifrato da noi», non
    // «questo si apre». Aprirlo è mestiere di src/lib/secrets.
    expect(sealedSecretSchema.safeParse("v1.aaa.bbb.ccc").success).toBe(true);
    expect(sealedSecretSchema.safeParse("v1.aaa.bbb").success).toBe(false);
    expect(sealedSecretSchema.safeParse("sk-proj-qualcosa").success).toBe(false);
  });
});

describe("i tre stati di un campo segreto in un modulo", () => {
  const base = {
    connector: null,
    connectorConfig: {},
    brainProvider: "fake",
    brainModel: null,
    brainBaseUrl: null,
  };

  it("assente significa «lascia stare quello che c'è»", () => {
    /*
     * È il caso normale, e va distinto dagli altri due o la configurazione si
     * perde a ogni salvataggio: la schermata non mostra mai la chiave, quindi
     * un modulo non può rimandarla indietro.
     */
    const parsed = updateProjectSettingsInputSchema.parse(base);

    expect(parsed.brainApiKey).toBeUndefined();
    expect("brainApiKey" in parsed).toBe(false);
  });

  it("nullo significa «toglila»", () => {
    const parsed = updateProjectSettingsInputSchema.parse({ ...base, brainApiKey: null });

    expect(parsed.brainApiKey).toBeNull();
  });

  it("una stringa significa «sostituiscila»", () => {
    const parsed = updateProjectSettingsInputSchema.parse({
      ...base,
      brainApiKey: "chiave-nuova",
    });

    expect(parsed.brainApiKey).toBe("chiave-nuova");
  });

  it("rifiuta una stringa vuota, che non è né una chiave né una cancellazione", () => {
    expect(() =>
      updateProjectSettingsInputSchema.parse({ ...base, brainApiKey: "" }),
    ).toThrow();
  });
});

describe("se il progetto può lavorare", () => {
  it("il modello finto funziona senza chiave, ed è voluto", () => {
    /*
     * Senza questo, l'unico modo di provare il portale sarebbe consegnare prima
     * una credenziale. Offrirlo non è una cortesia: è la differenza fra uno
     * strumento che si può guardare e uno che chiede il conto sulla porta.
     */
    expect(brainReady({ brainProvider: "fake", brainApiKey: null })).toBe(true);
  });

  it("ogni altro fornitore ha bisogno della chiave del cliente", () => {
    expect(brainReady({ brainProvider: "gemini", brainApiKey: null })).toBe(false);
    expect(brainReady({ brainProvider: "gemini", brainApiKey: "v1.a.b.c" })).toBe(true);
  });

  it("il connettore sintetico non ha bisogno di nulla", () => {
    // Genera i propri dati: chiedergli una credenziale sarebbe chiedergli il
    // permesso di parlare con se stesso.
    expect(
      connectorReady({ connector: "seed", connectorConfig: {}, connectorSecret: null }),
    ).toBe(true);
  });

  it("una configurazione senza credenziale non è pronta, e viceversa", () => {
    // È lo stato in cui resta un modulo compilato a metà, e va riconosciuto
    // prima che una sincronizzazione fallisca per una ragione oscura.
    expect(
      connectorReady({
        connector: "jira",
        connectorConfig: { projectKey: "SMAI" },
        connectorSecret: null,
      }),
    ).toBe(false);

    expect(
      connectorReady({ connector: "jira", connectorConfig: {}, connectorSecret: "v1.a.b.c" }),
    ).toBe(false);

    expect(
      connectorReady({
        connector: "jira",
        connectorConfig: { projectKey: "SMAI" },
        connectorSecret: "v1.a.b.c",
      }),
    ).toBe(true);
  });

  it("un progetto senza connettore scelto non è pronto", () => {
    expect(
      connectorReady({ connector: null, connectorConfig: {}, connectorSecret: null }),
    ).toBe(false);
  });
});

describe("impostazioni predefinite", () => {
  it("un progetto nuovo pensa con il modello finto e non è collegato a nulla", () => {
    expect(UNCONFIGURED_SETTINGS.brainProvider).toBe("fake");
    expect(UNCONFIGURED_SETTINGS.connector).toBeNull();
    expect(UNCONFIGURED_SETTINGS.brainApiKey).toBeNull();
  });
});
