import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export type Database = NeonHttpDatabase<typeof schema>;

/**
 * Builds a Drizzle instance over a connection string.
 *
 * Nothing is opened here: the Neon HTTP driver issues a request per statement,
 * which is what makes it usable from a serverless function where a long-lived
 * socket would be closed under it anyway.
 */
export function createDatabase(connectionString: string): Database {
  return drizzle(neon(connectionString), { schema });
}

let cached: Database | undefined;

/**
 * The application-wide instance, resolved on first use.
 *
 * Lazy on purpose: reading the environment at module load would make importing
 * anything under `src/db` fail in tests and in CI, where no database exists.
 * The failure belongs to the first query, not to the import.
 */
export function getDatabase(): Database {
  if (cached) return cached;

  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL non è impostata: copia .env.example in .env.local e valorizzala.",
    );
  }

  cached = createDatabase(connectionString);
  return cached;
}
