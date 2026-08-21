/**
 * Loads the synthetic data set into the database.
 *
 * Reconciliation keys on `(project_id, source_system, source_id)`, so running
 * this twice updates rather than duplicates — the idempotence the connector
 * instructions require, exercised here rather than merely claimed.
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
  });

  /**
   * Inserted in dependency order: a row cannot reference something that does
   * not exist yet. `onConflictDoNothing` turns a second run into a no-op rather
   * than an error.
   */
  const steps = [
    ["persone", people, batch.people],
    ["board", boards, batch.boards],
    ["colonne", boardColumns, batch.boardColumns],
    ["sprint", sprints, batch.sprints],
    ["elementi di lavoro", workItems, batch.workItems],
    ["transizioni", stateTransitions, batch.transitions],
    ["variazioni di perimetro", sprintScopeEvents, batch.scopeEvents],
    ["commenti", comments, batch.comments],
    ["impedimenti", impediments, batch.impediments],
    ["pull request", pullRequests, batch.pullRequests],
  ] as const;

  for (const [label, table, rows] of steps) {
    if (rows.length === 0) {
      console.log(`  ${label}: nessuna riga`);
      continue;
    }

    await db
      .insert(table)
      .values(rows as never)
      .onConflictDoNothing();
    console.log(`  ${label}: ${rows.length}`);
  }

  console.log("");
  console.log("Dati sintetici caricati.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
