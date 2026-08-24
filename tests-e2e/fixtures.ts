import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";

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

/**
 * Switches a capability on before a test that needs it.
 *
 * **Why this exists.** Enabled capabilities are shared state in a shared
 * database, and a test that fails halfway leaves them off. What follows is a
 * cascade: three suites go red, each reporting a missing button, and every one
 * of those reports is a symptom of a single earlier failure somewhere else.
 * Hours can go into the second and third symptom before anyone looks at the
 * first.
 *
 * So a test that needs a capability turns it on itself rather than inheriting
 * whatever the previous test happened to leave behind. It goes through the
 * interface deliberately: writing the row directly would let the suite pass on a
 * state the application has no way to reach.
 */
export async function enableSkill(
  page: Page,
  projectSlug: string,
  buttonLabel: string,
): Promise<void> {
  const card = `/progetti/${projectSlug}/scrum-master`;
  const offLabel = buttonLabel.replace(/^Abilita/, "Disabilita");

  await page.goto(card);

  const enable = page.getByRole("button", { name: buttonLabel });
  if ((await enable.count()) > 0) {
    await enable.first().click();
    await page.waitForLoadState("networkidle");

    /*
     * Un ricaricamento vero, non la pagina che il router tiene in memoria.
     *
     * Dopo una server action Next può servire la versione già scaricata di una
     * rotta per qualche decina di secondi. In una suite lunga questo si vede
     * come un interruttore che «non ha funzionato» — mentre ha funzionato, ed
     * è la pagina a essere vecchia. Eseguito isolato lo stesso test passa,
     * il che rende il difetto particolarmente adatto a essere attribuito al
     * codice sbagliato.
     */
    await page.reload();
  }

  /*
   * Si conferma l'esito, non lo si presume.
   *
   * Un helper che clicca e prosegue trasforma un'accensione non riuscita in un
   * fallimento lontano — un pulsante mancante in un'altra suite, minuti dopo,
   * dove nessuno lo collegherà a questo punto. Attendere qui che l'interruttore
   * risulti scattato fa fallire il test dove il problema è, con il nome della
   * capacità nel messaggio.
   */
  await expect(
    page.getByRole("button", { name: offLabel }),
    `la capacità non risulta accesa dopo «${buttonLabel}»`,
  ).toBeVisible({ timeout: 15_000 });
}
