/**
 * Loads the synthetic data set into the database.
 *
 * Deletes and rewrites the `seed` data for the project on every run, so the
 * database always reflects the connector as it is now. Reconciliation keys on
 * `(project_id, source_system, source_id)`, so a second run leaves the same
 * content, never duplicates.
 *
 * Behind a TLS-inspecting proxy:
 *
 *   $env:NODE_OPTIONS = "--use-system-ca"
 *   npm run seed
 *
 * Uses the first organization it finds, the common case on a development
 * machine with a single account.
 *
 * Written as a plain `.ts` with an explicit `main()` rather than an `.mts` with
 * top-level await. `package.json` declares no `"type": "module"`, so `src` is
 * CommonJS to Node; an ES module importing it lands in interop territory where
 * a schema barrel built on `export *` comes back empty. Keeping the script on
 * the same side of that boundary avoids the problem instead of working around
 * it (ADR-0007).
 */

import { existsSync } from "node:fs";

import { and, eq } from "drizzle-orm";

import { seedConnector } from "../src/connectors/seed";
import { createDatabase } from "../src/db/client";
import { toWorkItemRow } from "../src/db/rows";
import { organizationIdSchema, projectIdSchema } from "../src/domain";
import {
  boardColumns,
  boards,
  comments,
  impediments,
  organizations,
  people,
  projects,
  pullRequests,
  sprintScopeEvents,
  sprints,
  stateTransitions,
  workItems,
} from "../src/db/schema";

const PROJECT_SLUG = "checkout";

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL non impostata: copia .env.example in .env.local.");
  }

  const db = createDatabase(url);

  const [organization] = await db.select().from(organizations).limit(1);
  if (!organization) {
    throw new Error(
      "Nessuna organizzazione nel database. Registra un'azienda dall'applicazione, poi riprova.",
    );
  }

  /**
   * The tenant scope of `src/db/tenant.ts` is deliberately not used here.
   *
   * That scope constrains application code serving a session; this is a
   * development script running with full access. Borrowing it would suggest the
   * two situations are interchangeable, and they are not.
   */
  const existing = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.organizationId, organization.id), eq(projects.slug, PROJECT_SLUG)),
    );

  const project =
    existing[0] ??
    (
      await db
        .insert(projects)
        .values({
          organizationId: organization.id,
          name: "Checkout",
          slug: PROJECT_SLUG,
          description: "Rifacimento del flusso di pagamento. Dati sintetici.",
        })
        .returning()
    )[0];

  if (!project) throw new Error("Impossibile creare il progetto di prova.");

  console.log(`Organizzazione: ${organization.name}`);
  console.log(`Progetto:       ${project.name} (${project.slug})`);
  console.log("");

  const batch = await seedConnector.fetch({
    // Parsed rather than cast: the database returns plain strings, and
    // asserting them into branded types would prove nothing. This actually
    // checks that what came back is a UUID.
    organizationId: organizationIdSchema.parse(organization.id),
    projectId: projectIdSchema.parse(project.id),

    /*
     * L'unico punto di tutta la catena che guarda l'orologio, ed è quello
     * giusto.
     *
     * Il generatore colloca gli sprint all'indietro a partire da qui, così
     * l'ultimo è sempre in corso e la salute dello sprint ha qualcosa da
     * giudicare. Ogni altro livello riceve l'istante invece di leggerlo: è la
     * ragione per cui la stessa storia si può rigenerare identica in un test.
     */
    asOf: new Date(),
  });

  /**
   * Replace rather than merge.
   *
   * The previous version inserted with `onConflictDoNothing`, which made a
   * second run a silent no-op: once a row existed, no correction could ever
   * reach it. That is how every estimate in the database stayed null after the
   * writer was fixed. This data set is synthetic and regenerated in full, so
   * there is nothing to preserve — deleting first is both simpler and the only
   * version that actually reconciles.
   *
   * Scoped to this project and to `source_system = 'seed'`: data ingested from
   * a real tool must never be collateral damage of a seed run.
   */
  const deletions = [
    ["pull request", pullRequests],
    ["impedimenti", impediments],
    ["commenti", comments],
    ["variazioni di perimetro", sprintScopeEvents],
    ["transizioni", stateTransitions],
    ["elementi di lavoro", workItems],
    ["sprint", sprints],
    ["colonne", boardColumns],
    ["board", boards],
    ["persone", people],
  ] as const;

  for (const [, table] of deletions) {
    await db
      .delete(table)
      .where(and(eq(table.projectId, project.id), eq(table.sourceSystem, "seed")));
  }

  /**
   * Inserted in dependency order: a row cannot reference something that does
   * not exist yet.
   *
   * Each insert is its own statement rather than a loop over a heterogeneous
   * list, because the loop could only be made to compile with `as never` —
   * which disabled exactly the checking that would have been worth having.
   *
   * The connector returns `readonly` arrays, deliberately: nothing downstream
   * should be able to mutate what it produced. Drizzle asks for a mutable one,
   * so each is copied at the call site rather than weakening the connector's
   * type to suit the writer.
   */
  const insertions: readonly (readonly [string, number, () => Promise<unknown>])[] = [
    ["persone", batch.people.length, () => db.insert(people).values([...batch.people])],
    ["board", batch.boards.length, () => db.insert(boards).values([...batch.boards])],
    [
      "colonne",
      batch.boardColumns.length,
      () => db.insert(boardColumns).values([...batch.boardColumns]),
    ],
    ["sprint", batch.sprints.length, () => db.insert(sprints).values([...batch.sprints])],
    [
      "elementi di lavoro",
      batch.workItems.length,
      // The one entity whose row shape differs from the canonical one.
      () => db.insert(workItems).values(batch.workItems.map(toWorkItemRow)),
    ],
    [
      "transizioni",
      batch.transitions.length,
      () => db.insert(stateTransitions).values([...batch.transitions]),
    ],
    [
      "variazioni di perimetro",
      batch.scopeEvents.length,
      () => db.insert(sprintScopeEvents).values([...batch.scopeEvents]),
    ],
    [
      "commenti",
      batch.comments.length,
      () => db.insert(comments).values([...batch.comments]),
    ],
    [
      "impedimenti",
      batch.impediments.length,
      () => db.insert(impediments).values([...batch.impediments]),
    ],
    [
      "pull request",
      batch.pullRequests.length,
      () => db.insert(pullRequests).values([...batch.pullRequests]),
    ],
  ];

  for (const [label, count, run] of insertions) {
    if (count === 0) {
      console.log(`  ${label}: nessuna riga`);
      continue;
    }

    await run();
    console.log(`  ${label}: ${count}`);
  }

  console.log("");
  console.log("Dati sintetici caricati.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
