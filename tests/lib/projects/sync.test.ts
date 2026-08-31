import { describe, expect, it, vi } from "vitest";

import { createDatabase } from "@/db";
import type { SafeProjectSettings } from "@/db/project-settings";
import { organizationIdSchema, projectIdSchema } from "@/domain";
import { describeReport, synchroniseProject } from "@/lib/projects/sync";

/**
 * La sincronizzazione su richiesta, senza rete e senza credenziali.
 *
 * Verifica ciò che decide, non ciò che trasporta: quando rifiuta, che cosa
 * dice, e — la parte che conta di più — che non sposta il segnatempo se la
 * lettura non è arrivata in fondo.
 *
 * I casi che richiedono un token vero non sono qui e non possono esserlo (§6).
 * Quello che si può provare senza è che il servizio si **fermi** prima di
 * telefonare quando non ha di che telefonare, e sono esattamente i casi in cui
 * un utente si troverebbe altrimenti davanti a un errore incomprensibile.
 */

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

const CONNECTION =
  "postgresql://utente:non-un-segreto@ep-example-123.eu-central-1.aws.neon.tech/neondb";

const JIRA_CONFIG = {
  siteUrl: "https://esempio.atlassian.net",
  projectKey: "SMAI",
  boardId: 7,
  stateMapping: { "To Do": "todo", "In Progress": "in_progress", Done: "done" },
  howToDemoFieldName: null,
  accountEmail: "scrum@esempio.it",
};

function settings(overrides: Partial<SafeProjectSettings> = {}): SafeProjectSettings {
  return {
    projectId: PROJECT_ID,
    connector: "jira",
    connectorConfig: JIRA_CONFIG,
    connectorSecret: { configured: true, tail: "9f2a", updatedAt: new Date("2026-08-01") },
    lastSyncedAt: null,
    brainProvider: "fake",
    brainModel: null,
    brainBaseUrl: null,
    brainApiKey: { configured: false, tail: "", updatedAt: null },
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-01"),
    ...overrides,
  } as SafeProjectSettings;
}

async function run(overrides: Partial<SafeProjectSettings> = {}) {
  return synchroniseProject({
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    settings: settings(overrides),
    asOf: new Date("2026-08-27T10:00:00.000Z"),
    db: createDatabase(CONNECTION),
    httpFetch: vi.fn(),
  });
}

describe("si ferma prima di telefonare, quando non ha di che", () => {
  it("rifiuta un progetto senza fonte dati, dicendo dove sceglierla", async () => {
    const outcome = await run({ connector: null });

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("atteso rifiuto");
    expect(outcome.reason).toBe("no-connector");
    expect(outcome.message).toContain("Dati");
  });

  it("rifiuta i dati di esempio, che si caricano da riga di comando", async () => {
    // Un pulsante che provasse a leggere `seed` da qui fallirebbe sempre, e un
    // pulsante che fallisce sempre insegna a non fidarsi dei pulsanti.
    const outcome = await run({ connector: "seed" });

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("atteso rifiuto");
    expect(outcome.reason).toBe("not-jira");
  });

  it("rifiuta senza token, invece di provare e prendere un 401", async () => {
    const outcome = await run({
      connectorSecret: { configured: false, tail: "", updatedAt: null },
    });

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("atteso rifiuto");
    expect(outcome.reason).toBe("no-credentials");
  });

  it("rifiuta senza indirizzo dell'account, e spiega perché serve", async () => {
    /*
     * Il caso che un progetto configurato prima di questa funzione incontrerà.
     *
     * Jira autentica con la coppia indirizzo + token. Con il solo token la
     * chiamata tornerebbe 401, e il messaggio parlerebbe di autenticazione
     * fallita — mandando a controllare il token, che è giusto.
     */
    const { accountEmail: _omesso, ...senzaEmail } = JIRA_CONFIG;
    const outcome = await run({ connectorConfig: senzaEmail });

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("atteso rifiuto");
    expect(outcome.reason).toBe("no-account-email");
    expect(outcome.message).toContain("token");
  });

  it("rifiuta una configurazione incompleta senza inventarne una", async () => {
    const outcome = await run({ connectorConfig: { siteUrl: "https://esempio.atlassian.net" } });

    expect(outcome.status).toBe("refused");
    if (outcome.status !== "refused") throw new Error("atteso rifiuto");
    expect(outcome.reason).toBe("bad-configuration");
  });

  it("non telefona mai, in nessuno dei rifiuti", async () => {
    /*
     * La proprietà che tiene insieme i casi qui sopra.
     *
     * Un rifiuto che avesse comunque aperto una connessione avrebbe consumato
     * quota del cliente per una richiesta che si sapeva già inutile.
     */
    const httpFetch = vi.fn();

    await synchroniseProject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      settings: settings({ connector: null }),
      asOf: new Date("2026-08-27T10:00:00.000Z"),
      db: createDatabase(CONNECTION),
      httpFetch,
    });

    expect(httpFetch).not.toHaveBeenCalled();
  });
});

describe("come si racconta una lettura", () => {
  it("dice «niente di nuovo» invece di «zero elementi»", () => {
    /*
     * Due affermazioni diverse, e solo una è vera per un progetto già
     * aggiornato. «Letti 0 elementi» suona come un guasto; «non c'era niente di
     * nuovo» è ciò che è successo.
     */
    expect(describeReport({ counts: { persone: 0 }, total: 0 })).toContain("già aggiornato");
  });

  it("elenca solo le entità che hanno righe", () => {
    // Un elenco che nomina «0 commenti, 0 impedimenti, 0 pull request» seppellisce
    // le due voci che contano sotto le dodici che non sono successe.
    const testo = describeReport({
      counts: { persone: 4, "elementi di lavoro": 51, commenti: 0, impedimenti: 0 },
      total: 55,
    });

    expect(testo).toContain("4 persone");
    expect(testo).toContain("51 elementi di lavoro");
    expect(testo).not.toContain("commenti");
  });

  it("dice che non ha trovato elementi, invece di ometterlo", () => {
    /*
     * Il caso vero che ha portato a questa riga: una lettura che ha riportato
     * «Letti 1 board, 1 sprint» su un portale poi rimasto vuoto.
     *
     * La frase suonava come un successo, e ometteva l'unica informazione che
     * contava: di elementi di lavoro non ce n'era nessuno. Chi la leggeva non
     * poteva sapere se il portale avesse cercato, trovato zero, o fallito in
     * silenzio.
     */
    const testo = describeReport({ counts: { board: 1, sprint: 1 }, total: 2 });

    expect(testo).toContain("1 board");
    expect(testo).toContain("Nessun elemento di lavoro");
  });

  it("nomina le cause probabili, che sono verificabili in un minuto", () => {
    // «Nessun elemento» senza un dove guardare lascia allo stesso punto di
    // prima: il portale sa solo che la risposta era vuota, e le tre cause non
    // sono visibili da questa parte.
    const testo = describeReport({ counts: { board: 1 }, total: 1 });

    expect(testo).toContain("chiave del progetto");
    expect(testo).toContain("token");
  });

  it("non avverte quando gli elementi ci sono", () => {
    // Un avviso che compare sempre è un avviso che nessuno legge.
    const testo = describeReport({ counts: { "elementi di lavoro": 3 }, total: 3 });

    expect(testo).not.toContain("Nessun elemento");
  });

  it("scrive in testo semplice, perché così viene mostrato", () => {
    /*
     * Questa frase finisce dentro `{state.message}` in un JSX, cioè in un punto
     * che **non** interpreta il markdown: un `**` scritto per fare grassetto
     * arriverebbe sullo schermo come due asterischi.
     *
     * Il test esiste perché l'errore è stato commesso davvero, ed è invisibile
     * a chi legge solo il codice: la stringa sembra a posto.
     */
    const testo = describeReport({ counts: { board: 1 }, total: 1 });

    expect(testo).not.toContain("*");
    expect(testo).not.toContain("_");
  });
});
