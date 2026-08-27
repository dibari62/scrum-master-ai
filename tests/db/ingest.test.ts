import { describe, expect, it } from "vitest";

import { EMPTY_BATCH, type CanonicalBatch } from "@/connectors/contract";
import { createDatabase } from "@/db";
import {
  ingestBatch,
  ForeignOrganizationError,
  ForeignProjectError,
} from "@/db/ingest";
import {
  organizationIdSchema,
  personSchema,
  projectIdSchema,
  sprintIdSchema,
  workItemIdSchema,
  workItemSchema,
  type Person,
  type WorkItem,
} from "@/domain";

/**
 * Reconciling a connector's batch (spec del connettore Jira, §7).
 *
 * Like the isolation test, this runs on the statements produced rather than on
 * rows fetched from a live server: no database, no network, no credentials, so
 * it runs on every push. The Neon HTTP driver opens nothing until a statement
 * is awaited.
 *
 * What it proves is the property that makes a second synchronisation safe: the
 * write is an upsert keyed on the source record, and it never moves the columns
 * other rows depend on.
 */

/**
 * Una stringa di connessione finta ma sintatticamente valida.
 *
 * Il driver la analizza alla costruzione, quindi deve avere la forma giusta;
 * non apre nulla finché uno statement non viene atteso, e qui non lo è mai.
 */
const CONNECTION =
  "postgresql://utente:non-un-segreto@ep-example-123.eu-central-1.aws.neon.tech/neondb";

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const OTHER_ORGANIZATION = organizationIdSchema.parse("8a2d4f60-1c3b-4e97-8f5a-6b0d2e9c4713");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");
const OTHER_PROJECT = projectIdSchema.parse("1b4e7a92-5c8d-4306-9f21-7a3c5e8b0d64");
const SPRINT_ID = sprintIdSchema.parse("2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35");
const PERSON_ID = "4d6a8c02-7b19-4e35-8f47-2a9c6d1b3e50";
const WORK_ITEM_ID = workItemIdSchema.parse("5e8b1d47-9c2a-4f36-8b71-3d0a6e9f2c48");

/**
 * A database that records the statements it is asked to run instead of running
 * them.
 *
 * `insert(...).values(...).onConflictDoUpdate(...)` is a builder: awaiting it
 * is what would open a connection. Here each builder is turned into SQL with
 * `toSQL()` and kept, which is the whole point — the assertions are about the
 * statement, and a statement can be inspected without a server.
 */
function recordingDatabase() {
  const real = createDatabase(CONNECTION);
  const statements: string[] = [];

  const db = {
    insert: (table: Parameters<typeof real.insert>[0]) => {
      const builder = real.insert(table);

      return {
        values: (rows: never) => {
          const query = builder.values(rows);

          return {
            onConflictDoUpdate: (config: never) => {
              const finished = query.onConflictDoUpdate(config);
              statements.push(finished.toSQL().sql);
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof ingestBatch>[0]["db"];

  return { db, statements };
}

function person(overrides: Partial<Person> = {}): Person {
  return personSchema.parse({
    id: PERSON_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    sourceSystem: "jira",
    sourceId: "accountid:557058:abc",
    displayName: "Persona di prova",
    email: null,
    active: true,
    createdAt: "2026-04-06T08:00:00.000Z",
    updatedAt: "2026-04-06T08:00:00.000Z",
    ...overrides,
  });
}

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return workItemSchema.parse({
    id: WORK_ITEM_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    sourceSystem: "jira",
    sourceId: "PRJ-1",
    kind: "story",
    title: "Elemento di prova",
    description: null,
    state: "todo",
    estimate: { value: 3, unit: "points" },
    backlogOrder: null,
    howToDemo: null,
    sprintId: SPRINT_ID,
    assigneeId: null,
    sourceCreatedAt: "2026-04-06T08:00:00.000Z",
    parentId: null,
    createdAt: "2026-04-06T08:00:00.000Z",
    updatedAt: "2026-04-06T08:00:00.000Z",
    ...overrides,
  });
}

function batchWith(overrides: Partial<CanonicalBatch>): CanonicalBatch {
  return { ...EMPTY_BATCH, ...overrides };
}

async function ingest(batch: CanonicalBatch) {
  const { db, statements } = recordingDatabase();

  const report = await ingestBatch({
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    batch,
    db,
  });

  return { report, statements };
}

describe("riconciliazione di un lotto", () => {
  it("aggiorna invece di duplicare, sulla chiave del record di origine", async () => {
    /*
     * La proprietà che rende ripetibile una sincronizzazione.
     *
     * Senza `on conflict`, la seconda lettura dello stesso progetto Jira
     * inserirebbe ogni elemento una seconda volta, e ogni metrica di flusso
     * conterebbe il doppio del lavoro.
     */
    const { statements } = await ingest(batchWith({ people: [person()] }));

    expect(statements).toHaveLength(1);
    const [statement = ""] = statements;

    expect(statement).toMatch(/on conflict/i);
    expect(statement).toMatch(/"project_id","source_system","source_id"/);
    expect(statement).toMatch(/do update set/i);
  });

  it("non riscrive la chiave primaria, che altre tabelle usano per puntare", async () => {
    /*
     * Il difetto che questo test esiste per impedire.
     *
     * Una transizione punta al suo elemento per chiave primaria. Se
     * l'aggiornamento riassegnasse `id`, il riferimento resterebbe appeso —
     * oppure, peggio, punterebbe all'elemento sbagliato, e nessun errore
     * verrebbe sollevato.
     */
    const { statements } = await ingest(batchWith({ workItems: [workItem()] }));

    const [statement = ""] = statements;
    const set = statement.slice(statement.toLowerCase().indexOf("do update set"));

    expect(set).not.toMatch(/"id" = excluded/);
    expect(set).not.toMatch(/"created_at" = excluded/);
    expect(set).toMatch(/"title" = excluded/);
    expect(set).toMatch(/"state" = excluded/);
  });

  it("non manda alcuna istruzione per un'entità vuota", async () => {
    // Un `insert ... values ()` senza righe è un errore, non un'operazione
    // neutra: un lotto che non contiene commenti non deve produrne uno.
    const { statements, report } = await ingest(batchWith({ people: [person()] }));

    expect(statements).toHaveLength(1);
    expect(report.counts["commenti"]).toBe(0);
    expect(report.total).toBe(1);
  });

  it("scrive nell'ordine che le chiavi esterne impongono", async () => {
    /*
     * Le persone e gli sprint prima degli elementi, gli elementi prima della
     * loro storia. Non è una preferenza di lettura: una riga non può
     * riferirsi a qualcosa che non esiste ancora.
     */
    const { statements } = await ingest(
      batchWith({ people: [person()], workItems: [workItem()] }),
    );

    const [first = "", second = ""] = statements;
    expect(first).toMatch(/into "people"/);
    expect(second).toMatch(/into "work_items"/);
  });

  it("rifiuta un lotto che nomina un'altra organizzazione", async () => {
    /*
     * §8.4. Riscrivere la chiave farebbe entrare il lotto comunque, e le righe
     * atterrerebbero con l'aspetto di dati perfettamente ordinari: è così che
     * i dati di un'organizzazione finiscono sotto gli occhi di un'altra.
     */
    await expect(
      ingest(batchWith({ people: [person({ organizationId: OTHER_ORGANIZATION })] })),
    ).rejects.toBeInstanceOf(ForeignOrganizationError);
  });

  it("rifiuta un lotto che nomina un altro progetto", async () => {
    // Il caso realistico: un connettore puntato sulla board sbagliata.
    await expect(
      ingest(batchWith({ workItems: [workItem({ projectId: OTHER_PROJECT })] })),
    ).rejects.toBeInstanceOf(ForeignProjectError);
  });

  it("rifiuta prima di scrivere qualsiasi cosa, non a metà", async () => {
    /*
     * Le persone sono valide e verrebbero scritte per prime; l'elemento di
     * lavoro appartiene a un altro progetto. Senza il controllo anticipato, il
     * rifiuto arriverebbe con le persone già dentro.
     */
    const { db, statements } = recordingDatabase();

    await expect(
      ingestBatch({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        batch: batchWith({
          people: [person()],
          workItems: [workItem({ projectId: OTHER_PROJECT })],
        }),
        db,
      }),
    ).rejects.toBeInstanceOf(ForeignProjectError);

    expect(statements).toHaveLength(0);
  });

  it("conta ciò che ha scritto, entità per entità", async () => {
    const { report } = await ingest(
      batchWith({ people: [person()], workItems: [workItem()] }),
    );

    expect(report.counts["persone"]).toBe(1);
    expect(report.counts["elementi di lavoro"]).toBe(1);
    expect(report.total).toBe(2);
  });
});
