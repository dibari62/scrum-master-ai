import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { writeProjectSettings } from "@/db/project-settings";
import { organizationIdSchema, projectIdSchema } from "@/domain";

/**
 * Il cursore delle letture, e quando va dimenticato.
 *
 * **Il difetto che questi test bloccano, trovato su un'istanza Jira vera.**
 * Dopo la prima lettura il portale chiede a Jira soltanto «che cosa è cambiato
 * da allora». È giusto finché si guarda lo stesso posto, ed è un buco nero
 * appena quel posto cambia: chi corregge una chiave di progetto sbagliata
 * continua a chiedere solo le novità, e tutto ciò che esisteva prima della
 * correzione non viene letto mai più.
 *
 * Il guasto non produce errori. La lettura riesce, il messaggio dice «letti 1
 * board, 1 sprint», e il portale resta vuoto.
 *
 * Come per gli altri test di questo livello: nessun database e nessuna rete —
 * si guarda lo statement che sarebbe stato eseguito, e uno statement si può
 * leggere senza un server.
 */

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

const NOW = new Date("2026-08-31T15:00:00.000Z");

const STORED_CONFIG = {
  siteUrl: "https://esempio.atlassian.net",
  projectKey: "PIER",
  boardId: 1,
  stateMapping: { "To Do": "todo", Done: "done" },
  accountEmail: "chi@example.invalid",
};

/**
 * Un database che risponde con una riga già presente e registra la scrittura.
 *
 * Serve una `select` che risponda — `writeProjectSettings` legge ciò che c'è
 * prima di decidere cosa cambia — e una `insert` che non parta mai. Non c'è
 * bisogno di un client vero: qui interessa **quali valori** verrebbero scritti,
 * non l'SQL che li porterebbe.
 */
function recordingDatabase(stored: Record<string, unknown>) {
  const written: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([stored]),
      }),
    }),
    insert: () => ({
      values: (rows: Record<string, unknown>) => {
        written.push(rows);

        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    }),
  } as unknown as Parameters<typeof writeProjectSettings>[4];

  return { db, written };
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    connector: "jira",
    connectorConfig: STORED_CONFIG,
    connectorSecret: "v1.abc",
    connectorSecretUpdatedAt: new Date("2026-08-30T10:00:00.000Z"),
    brainProvider: "fake",
    brainModel: null,
    brainBaseUrl: null,
    brainApiKey: null,
    brainApiKeyUpdatedAt: null,
    lastSyncedAt: new Date("2026-08-31T12:33:00.000Z"),
    createdAt: new Date("2026-08-30T10:00:00.000Z"),
    updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    ...overrides,
  };
}

async function save(input: Parameters<typeof writeProjectSettings>[2], stored = storedRow()) {
  const { db, written } = recordingDatabase(stored);

  await writeProjectSettings(ORGANIZATION_ID, PROJECT_ID, input, NOW, db);

  return written[0] ?? {};
}

describe("il cursore delle letture", () => {
  /*
   * Una chiave di custodia finta, per il solo caso che cifra qualcosa.
   *
   * Salvare un token nuovo lo sigilla prima di scriverlo, e senza una chiave
   * quel passaggio si rifiuta — giustamente. La chiave è generata qui e non
   * esce da qui: nessun valore vero entra in un file versionato (§8.3).
   */
  beforeAll(() => {
    vi.stubEnv("SECRETS_KEY", randomBytes(32).toString("base64"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("si azzera quando cambia la chiave del progetto", async () => {
    /*
     * Il caso vero: la chiave era sbagliata, la prima lettura non ha trovato
     * nulla e ha comunque spostato il cursore. Senza azzerarlo, correggere la
     * chiave non serve a niente — si continua a chiedere solo le novità di un
     * progetto di cui non si è mai letto il passato.
     */
    const values = await save({
      connectorConfig: { ...STORED_CONFIG, projectKey: "SCRUM" },
    });

    expect(values["lastSyncedAt"]).toBeNull();
  });

  it("si azzera quando cambia il sito", async () => {
    const values = await save({
      connectorConfig: { ...STORED_CONFIG, siteUrl: "https://altra.atlassian.net" },
    });

    expect(values["lastSyncedAt"]).toBeNull();
  });

  it("si azzera quando cambia il token", async () => {
    // Un token diverso può appartenere a un account che vede cose diverse:
    // ciò che era invisibile prima non arriverebbe mai.
    const values = await save({ connectorSecret: "token-nuovo" });

    expect(values["lastSyncedAt"]).toBeNull();
  });

  it("si azzera quando cambia la mappatura degli stati", async () => {
    // Cambia l'interpretazione, non l'insieme: ma un elemento già tradotto con
    // la mappatura vecchia resta sbagliato finché non lo si rilegge.
    const values = await save({
      connectorConfig: {
        ...STORED_CONFIG,
        stateMapping: { "To Do": "todo", "In Review": "in_review", Done: "done" },
      },
    });

    expect(values["lastSyncedAt"]).toBeNull();
  });

  it("resta dov'è quando si salva la stessa configurazione", async () => {
    /*
     * Premere «Salva» senza cambiare nulla non deve costare una rilettura
     * completa: succede continuamente, ed è il modo più facile per consumare la
     * quota di chiamate di qualcun altro.
     */
    const values = await save({ connectorConfig: { ...STORED_CONFIG } });

    expect(values["lastSyncedAt"]).toBeUndefined();
  });

  it("resta dov'è quando la stessa configurazione arriva con le chiavi in ordine diverso", async () => {
    // Due oggetti uguali scritti in ordine diverso descrivono lo stesso posto.
    const values = await save({
      connectorConfig: {
        accountEmail: STORED_CONFIG.accountEmail,
        boardId: STORED_CONFIG.boardId,
        projectKey: STORED_CONFIG.projectKey,
        siteUrl: STORED_CONFIG.siteUrl,
        stateMapping: { Done: "done", "To Do": "todo" },
      },
    });

    expect(values["lastSyncedAt"]).toBeUndefined();
  });

  it("resta dov'è quando si cambia solo il modello linguistico", async () => {
    // Il modello racconta i numeri, non li procura: cambiarlo non rende
    // incompleto nulla di ciò che è già stato letto.
    const values = await save({ brainProvider: "gemini", brainModel: "gemini-2.0-flash" });

    expect(values["lastSyncedAt"]).toBeUndefined();
  });
});
