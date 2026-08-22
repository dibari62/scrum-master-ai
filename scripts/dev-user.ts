/**
 * Adds or removes a temporary inspector account.
 *
 * **Why this exists.** Verifying a page behind sign-in requires an account, and
 * nobody's password should ever be shared to get one. This creates a
 * throw-away member of an existing organization, uses it, and removes it.
 *
 * Written as a `.ts` run through `tsx` rather than a standalone `.mjs`
 * specifically so it can import `hashPassword` from the application. An earlier
 * version reimplemented the scrypt format by hand; the day the real hashing
 * changes, that copy would keep producing credentials that no longer work, and
 * the failure would look like a bug in sign-in (ADR-0007 for the `.ts` choice).
 *
 *   npm run dev:user            -- elenca gli account temporanei
 *   npm run dev:user -- add     -- crea l'account
 *   npm run dev:user -- remove  -- lo elimina
 *
 * Behind a TLS-inspecting proxy set `NODE_OPTIONS=--use-system-ca` first.
 */

import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { createDatabase } from "../src/db/client";
import { memberships, organizations, userCredentials, users } from "../src/db/schema";
import { organizationRoleSchema } from "../src/domain";
import { hashPassword } from "../src/lib/password";

/**
 * A reserved domain, so a stray address can never reach a real mailbox, and a
 * fictional person (`AGENTS.md` §8.2).
 */
const EMAIL = "ispettore-temporaneo@example.invalid";
const NAME = "Ispettore Temporaneo";

/**
 * Deliberately memorable and deliberately worthless: the account exists for
 * minutes, in a database holding invented data, and is removed straight after.
 * It must never be reused for anything that matters.
 */
const PASSWORD = "cavallo-batteria-graffetta";

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL non impostata: vedi docs/setup-ambiente.md");

  const db = createDatabase(url);
  const command = process.argv[2] ?? "list";

  /*
   * The role matters, so it is a parameter.
   *
   * Some screens are restricted to `owner`/`admin`, which means a single
   * hard-coded `member` could only ever exercise the refusal. Both paths have
   * to be walkable to know either of them works.
   */
  const roleArgument = process.argv[3] ?? "member";
  const role = organizationRoleSchema.safeParse(roleArgument);
  if (!role.success) {
    throw new Error(`ruolo sconosciuto: ${roleArgument}. Usa owner | admin | member.`);
  }

  const existing = await db.select().from(users).where(eq(users.email, EMAIL));

  if (command === "list") {
    console.log(
      existing.length === 0
        ? "nessun account temporaneo presente"
        : `ATTENZIONE: account temporaneo ancora presente (${EMAIL}). Rimuovilo con: npm run dev:user -- remove`,
    );
    return;
  }

  if (command === "remove") {
    const removed = await db.delete(users).where(eq(users.email, EMAIL)).returning();
    console.log(`account temporanei rimossi: ${removed.length}`);
    return;
  }

  if (command !== "add") {
    throw new Error(`comando sconosciuto: ${command}. Usa list | add | remove.`);
  }

  if (existing.length > 0) {
    console.log(`già presente: ${EMAIL}`);
    return;
  }

  const [organization] = await db
    .select()
    .from(organizations)
    .orderBy(organizations.createdAt)
    .limit(1);

  if (!organization) throw new Error("nessuna organizzazione: esegui prima npm run seed");

  /*
   * Three writes that belong together: a user without credentials cannot sign
   * in, and one without a membership sees an empty application.
   *
   * `db.batch` and not `db.transaction`: the Neon HTTP driver has no
   * interactive transactions, but it does send a batch as a single server-side
   * transaction. The identifier therefore has to be generated here rather than
   * read back from `DEFAULT`. The first version of this script used
   * `db.transaction` and failed at runtime — the same trap `src/db/users.ts`
   * had already documented.
   */
  const userId = randomUUID();
  const passwordHash = await hashPassword(PASSWORD);

  await db.batch([
    db.insert(users).values({ id: userId, email: EMAIL, name: NAME }),
    db.insert(userCredentials).values({ userId, passwordHash }),
    db
      .insert(memberships)
      .values({ organizationId: organization.id, userId, role: role.data }),
  ]);

  console.log(`account temporaneo aggiunto a "${organization.name}"`);
  console.log(`  email:    ${EMAIL}`);
  console.log(`  ruolo:    ${role.data}`);
  console.log(`  password: ${PASSWORD}`);
  console.log("");
  console.log("RICORDA di rimuoverlo: npm run dev:user -- remove");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
