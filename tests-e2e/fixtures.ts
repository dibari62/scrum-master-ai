import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { createDatabase, type Database } from "@/db";
import { organizations, users } from "@/db/schema";

/**
 * Fixtures for the end-to-end suite.
 *
 * Everything created here is addressed explicitly on the way out. The database
 * these tests run against also holds rows a person created by hand, so a
 * blanket cleanup is not an option: it would delete work nobody can recover.
 */

/** Reserved domain, so a stray address can never reach a real mailbox (§8.2). */
const DOMAIN = "example.invalid";

export const PASSWORD = "cavallo-batteria-graffetta";

export type Fixture = {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly personName: string;
  readonly email: string;
  readonly password: string;
};

/**
 * Builds a unique fixture.
 *
 * The random suffix keeps a re-run from colliding with leftovers of a previous
 * one — including a run that crashed before cleaning up.
 */
export function makeFixture(label: string): Fixture {
  const run = randomBytes(4).toString("hex");

  return {
    organizationName: `${label} ${run}`,
    organizationSlug: `e2e-${label}-${run}`,
    personName: "Giulia Rossi",
    email: `e2e-${label}-${run}@${DOMAIN}`,
    password: PASSWORD,
  };
}

export function database(): Database {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL non impostata: i test e2e richiedono un database.");
  }

  return createDatabase(url);
}

/**
 * Removes exactly the rows a fixture produced.
 *
 * The organization cascades to its memberships and projects, the user to its
 * credentials, so two deletes are enough.
 */
export async function removeFixture(fixture: Fixture): Promise<void> {
  const db = database();

  await db.delete(organizations).where(eq(organizations.slug, fixture.organizationSlug));
  await db.delete(users).where(eq(users.email, fixture.email));
}
