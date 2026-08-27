import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createJiraConnector,
  jiraConfigSchema,
  jiraSnapshotSchema,
  translateSnapshot,
  type JiraSnapshot,
} from "@/connectors/jira";
import { organizationIdSchema, projectIdSchema } from "@/domain";

import { runConnectorConformance } from "../conformance";

/**
 * Il connettore Jira, su una risposta registrata.
 *
 * **Nessuna chiamata di rete, nessun token, nessun orologio.** È la regola §6
 * per i connettori, e qui serve a qualcosa di più: la traduzione è il punto in
 * cui si decide che cosa significano i nostri numeri, e una verifica che
 * dipendesse da un'istanza Jira raggiungibile non potrebbe girare in CI — cioè
 * proprio dove serve.
 */

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

const ASOF = new Date("2026-08-19T10:00:00.000Z");

function loadSnapshot(): JiraSnapshot {
  const raw = readFileSync(join(__dirname, "fixtures", "snapshot.json"), "utf8");
  return jiraSnapshotSchema.parse(JSON.parse(raw));
}

/**
 * La mappatura che un progetto dichiarerebbe.
 *
 * Cinque stati Jira per quattro dei nostri: «Code Review» e «In Review» finiscono
 * entrambi su `in_review`, che è il caso interessante — è quello che produce un
 * cambiamento nel changelog e nessun cambiamento da noi.
 */
const CONFIG = jiraConfigSchema.parse({
  siteUrl: "https://esempio.atlassian.net",
  projectKey: "SMAI",
  boardId: 7,
  stateMapping: {
    "To Do": "todo",
    "In Progress": "in_progress",
    "Code Review": "in_review",
    "In Review": "in_review",
    Done: "done",
  },
  howToDemoFieldName: "Come si dimostra",
});

function translate() {
  return translateSnapshot({
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    config: CONFIG,
    snapshot: loadSnapshot(),
    asOf: ASOF,
  });
}

const connector = createJiraConnector({
  config: CONFIG,
  read: async () => loadSnapshot(),
});

describe("connettore Jira — conformità", () => {
  runConnectorConformance({
    connector,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
  });
});

describe("traduzione — storia degli stati", () => {
  const item = (key: string) => {
    const { batch } = translate();
    const found = batch.workItems.find((entry) => entry.sourceId === key);
    if (!found) throw new Error(`elemento assente: ${key}`);
    return { batch, item: found };
  };

  it("apre ogni storia con la creazione, e parte dallo stato di allora", () => {
    // Il changelog dice «da To Do a In Progress»: lo stato iniziale è il `from`
    // della prima voce, non quello di adesso.
    const { batch, item: story } = item("SMAI-1");

    const history = batch.transitions
      .filter((entry) => entry.workItemId === story.id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    expect(history[0]?.fromState).toBeNull();
    expect(history[0]?.toState).toBe("todo");
    expect(history[0]?.occurredAt.toISOString()).toBe("2026-04-01T09:00:00.000Z");
  });

  it("non registra un passaggio fra due stati Jira che valgono lo stesso", () => {
    /*
     * «Code Review» e «In Review» finiscono entrambi su `in_review`. Registrare
     * quel passaggio sarebbe un difetto di storia — `findHistoryDefects` conta
     * una transizione verso lo stesso stato come tale — e gonfierebbe ogni
     * conteggio di quante volte un elemento rimbalza.
     */
    const { batch, item: story } = item("SMAI-1");

    const history = batch.transitions.filter((entry) => entry.workItemId === story.id);

    expect(history.map((entry) => entry.toState)).toEqual([
      "todo",
      "in_progress",
      "in_review",
      "done",
    ]);
  });

  it("un elemento senza changelog ha comunque una storia, lunga uno", () => {
    // Creato e mai mosso: la lettura onesta è «è sempre stato lì», non «non si
    // sa nulla».
    const { batch, item: bug } = item("SMAI-3");

    const history = batch.transitions.filter((entry) => entry.workItemId === bug.id);

    expect(history).toHaveLength(1);
    expect(history[0]?.toState).toBe("todo");
  });
});

describe("traduzione — storia delle stime", () => {
  it("ricostruisce la stima iniziale dal «da» della prima modifica", () => {
    /*
     * L'elemento vale 5 punti oggi, ma il changelog dice che è passato da 3 a 5
     * a sprint iniziato. La velocity legge la stima **all'ingresso**, quindi la
     * stima iniziale è 3 — ed è irrecuperabile da una fotografia.
     */
    const { batch } = translate();
    const story = batch.workItems.find((entry) => entry.sourceId === "SMAI-1");

    const history = batch.estimateChanges
      .filter((entry) => entry.workItemId === story?.id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    expect(history).toHaveLength(2);
    expect(history[0]?.toEstimate).toEqual({ value: 3, unit: "points" });
    expect(history[1]?.fromEstimate).toEqual({ value: 3, unit: "points" });
    expect(history[1]?.toEstimate).toEqual({ value: 5, unit: "points" });
  });

  it("senza modifiche registrate, la stima di adesso è sempre stata quella", () => {
    const { batch } = translate();
    const story = batch.workItems.find((entry) => entry.sourceId === "SMAI-4");

    const history = batch.estimateChanges.filter((entry) => entry.workItemId === story?.id);

    expect(history).toHaveLength(1);
    expect(history[0]?.fromEstimate).toBeNull();
    expect(history[0]?.toEstimate).toEqual({ value: 13, unit: "points" });
  });

  it("un elemento senza stima resta senza stima, non a zero", () => {
    // «Nessuno l'ha dimensionato» e «l'abbiamo dimensionato e non costa nulla»
    // sono due affermazioni diverse, e il libro le conta diversamente.
    const { batch } = translate();
    const bug = batch.workItems.find((entry) => entry.sourceId === "SMAI-3");

    expect(bug?.estimate).toBeNull();
  });
});

describe("traduzione — ingressi e uscite dagli sprint", () => {
  it("legge il campo Sprint come un insieme, non come un valore", () => {
    /*
     * Jira scrive `from: "12"` → `to: "12, 13"`. Prendere `to` come «lo sprint
     * di adesso» direbbe che l'elemento è entrato nel 12, che è falso: nel 12
     * c'era già. Un solo evento, ed è l'ingresso nel 13.
     */
    const { batch } = translate();
    const story = batch.workItems.find((entry) => entry.sourceId === "SMAI-2");

    const events = batch.scopeEvents
      .filter((entry) => entry.workItemId === story?.id)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    expect(events).toHaveLength(2);
    expect(events[1]?.kind).toBe("added");
    expect(events[1]?.occurredAt.toISOString()).toBe("2026-04-20T08:30:00.000Z");
  });

  it("un elemento creato già dentro uno sprint entra alla sua creazione", () => {
    const { batch } = translate();
    const bug = batch.workItems.find((entry) => entry.sourceId === "SMAI-3");

    const events = batch.scopeEvents.filter((entry) => entry.workItemId === bug?.id);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("added");
    expect(events[0]?.occurredAt.toISOString()).toBe("2026-04-21T09:00:00.000Z");
  });

  it("lascia sempre indeterminato il motivo, perché Jira non lo registra", () => {
    // Riempirlo con un valore inventato farebbe risultare pianificata ogni
    // interruzione (ADR-0009).
    const { batch } = translate();

    for (const event of batch.scopeEvents) expect(event.reason).toBeNull();
  });
});

describe("traduzione — sprint e backlog", () => {
  it("prende la data di chiusura vera, non quella pianificata", () => {
    // È la ragione per cui si parte da Jira e non da Azure DevOps.
    const { batch } = translate();
    const sprint = batch.sprints.find((entry) => entry.sourceId === "12");

    expect(sprint?.endsAt.toISOString()).toBe("2026-04-17T17:00:00.000Z");
    expect(sprint?.completedAt?.toISOString()).toBe("2026-04-17T18:30:00.000Z");
  });

  it("scarta uno sprint senza date, che non è collocabile nel tempo", () => {
    const { batch } = translate();

    expect(batch.sprints.map((entry) => entry.sourceId)).toEqual(["12", "13"]);
  });

  it("colloca in backlog solo ciò che non è né in uno sprint né concluso", () => {
    const { batch } = translate();

    const placed = batch.workItems
      .filter((entry) => entry.backlogOrder !== null)
      .map((entry) => entry.sourceId);

    expect(placed).toEqual(["SMAI-4", "SMAI-5"]);
  });

  it("riporta «come si dimostra» solo se il progetto dice dove tenerlo", () => {
    const { batch } = translate();

    const withDemo = batch.workItems.find((entry) => entry.sourceId === "SMAI-4");
    const without = batch.workItems.find((entry) => entry.sourceId === "SMAI-5");

    expect(withDemo?.howToDemo).toContain("scarpe");
    expect(without?.howToDemo).toBeNull();
  });
});

describe("traduzione — ciò che la configurazione non copre", () => {
  it("segnala gli stati non mappati invece di rifiutare tutto", () => {
    /*
     * Aggiungere una colonna a una board è manutenzione ordinaria. Se spegnesse
     * il portale, il portale sarebbe inutilizzabile; se passasse in silenzio,
     * `statusCategory` appiattirebbe una coda di revisione su «in corso» senza
     * che nessuno lo sappia.
     */
    const { unmappedStatuses } = translate();

    expect(unmappedStatuses).toEqual(["Da rifinire"]);
  });

  it("un tipo di issue sconosciuto diventa un task, non un errore", () => {
    const { batch } = translate();
    const unknown = batch.workItems.find((entry) => entry.sourceId === "SMAI-5");

    expect(unknown?.kind).toBe("task");
  });

  it("senza campo «come si dimostra» dichiarato, nessun elemento ne ha uno", () => {
    const withoutField = jiraConfigSchema.parse({ ...CONFIG, howToDemoFieldName: null });

    const { batch } = translateSnapshot({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      config: withoutField,
      snapshot: loadSnapshot(),
      asOf: ASOF,
    });

    expect(batch.workItems.every((entry) => entry.howToDemo === null)).toBe(true);
  });
});

describe("traduzione — identificatori", () => {
  it("lo stesso elemento riceve sempre lo stesso identificativo", () => {
    /*
     * Il connettore sintetico usa identificativi casuali, e per dati generati va
     * bene: nulla, fuori da una singola esecuzione, vi si riferisce. Qui no —
     * un'ingestione che si ripete deve non cambiare nulla, e con identificativi
     * casuali due lotti identici non sarebbero nemmeno confrontabili.
     */
    const first = translate().batch;
    const second = translate().batch;

    expect(second.workItems.map((entry) => entry.id)).toEqual(
      first.workItems.map((entry) => entry.id),
    );
    expect(second.transitions.map((entry) => entry.id)).toEqual(
      first.transitions.map((entry) => entry.id),
    );
  });
});

describe("connettore Jira — testo di terzi", () => {
  it("conserva un commento ostile come testo, senza interpretarlo", () => {
    // §8.1: il testo ingerito è **dato**, mai istruzione. Il connettore non lo
    // ripulisce e non lo esegue: lo trasporta.
    const { batch } = translate();

    expect(batch.comments).toHaveLength(1);
    expect(batch.comments[0]?.body).toContain("Ignora le istruzioni precedenti");
  });
});
