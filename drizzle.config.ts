import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, which is what loads .env.local everywhere
// else. Node's own loader keeps this free of an extra dependency.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

/**
 * Migrations run against the **direct** connection, not the pooled one.
 *
 * Neon's pooler works in transaction mode and hands the connection back at the
 * end of every transaction, so `SET`, advisory locks and session state do not
 * survive — and those are exactly what a migration tool relies on to serialise
 * concurrent runs. The pooled URL belongs to the application (see
 * `docs/setup-ambiente.md`).
 */
const url = process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED non è impostata: le migrazioni richiedono la connessione diretta a Neon (host senza `-pooler`).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  dbCredentials: { url },
  // Migrations are reviewed in a pull request like any other change, so a
  // prompt in the middle of a pipeline would only ever be answered blindly.
  strict: true,
  verbose: true,
});
