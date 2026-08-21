import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";

import { memberships, organizations, userCredentials, users } from "@/db/schema";

import { database, makeFixture, removeFixture, type Fixture } from "./fixtures";

/**
 * Registration and sign-in, driven through a real browser.
 *
 * This is the only way to exercise a server action: its identifier is generated
 * at build time, so no HTTP client can invoke it directly. Everything below the
 * form is already covered by unit and integration tests — what is verified here
 * is the wiring between them.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

test.describe("registrazione e accesso", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test scrivono su un database reale");

  const created: Fixture[] = [];

  test.afterAll(async () => {
    for (const fixture of created) await removeFixture(fixture);
    created.length = 0;
  });

  test("lo slug segue il nome dell'azienda finché non lo si modifica", async ({ page }) => {
    await page.goto("/registrati");

    await page.fill("#organizationName", "Acme Società à Responsabilità");
    await expect(page.locator("#organizationSlug")).toHaveValue(
      "acme-societa-a-responsabilita",
    );

    // Una volta scelto a mano, lo slug non deve più cambiare da solo:
    // sovrascrivere una decisione esplicita al tasto successivo è il tipo di
    // gentilezza contro cui le persone combattono.
    await page.fill("#organizationSlug", "scelto-a-mano");
    await page.fill("#organizationName", "Nome Completamente Diverso");
    await expect(page.locator("#organizationSlug")).toHaveValue("scelto-a-mano");
  });

  test("una password troppo corta è segnalata sul campo e non svuota il modulo", async ({
    page,
  }) => {
    const fixture = makeFixture("corta");
    await page.goto("/registrati");

    await page.fill("#organizationName", fixture.organizationName);
    await page.fill("#organizationSlug", fixture.organizationSlug);
    await page.fill("#name", fixture.personName);
    await page.fill("#email", fixture.email);
    await page.fill("#password", "corta");
    await page.click('button[type="submit"]');

    await expect(page.getByText("La password deve avere almeno 12 caratteri.")).toBeVisible();
    await expect(page.locator("#password")).toHaveAttribute("aria-invalid", "true");

    // La password non torna mai indietro nell'HTML; il resto sì, altrimenti si
    // riscrive tutto da capo.
    await expect(page.locator("#password")).toHaveValue("");
    await expect(page.locator("#organizationName")).toHaveValue(fixture.organizationName);
    await expect(page.locator("#email")).toHaveValue(fixture.email);
  });

  test("la registrazione crea l'azienda, accede da sola e mostra l'area riservata", async ({
    page,
  }) => {
    const fixture = makeFixture("registrazione");
    created.push(fixture);

    await page.goto("/registrati");
    await page.fill("#organizationName", fixture.organizationName);
    await page.fill("#organizationSlug", fixture.organizationSlug);
    await page.fill("#name", fixture.personName);
    await page.fill("#email", fixture.email);
    await page.fill("#password", fixture.password);
    await page.click('button[type="submit"]');

    await page.waitForURL("**/organizzazione");
    await expect(page.getByText(fixture.organizationName)).toBeVisible();
    // `exact` perché l'indirizzo email contiene lo slug come sottostringa:
    // senza, il localizzatore ne trova due e fallisce per il motivo sbagliato.
    await expect(page.getByText(fixture.organizationSlug, { exact: true })).toBeVisible();
    await expect(page.getByText("Proprietario")).toBeVisible();
    await expect(page.getByText(fixture.email)).toBeVisible();

    // Le quattro righe devono esistere davvero: la pagina potrebbe mostrare
    // dati di sessione senza che nulla sia stato scritto.
    const db = database();
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, fixture.organizationSlug));
    expect(organization?.name).toBe(fixture.organizationName);

    const [user] = await db.select().from(users).where(eq(users.email, fixture.email));
    expect(user).toBeDefined();

    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, user!.id));
    expect(credential?.passwordHash).not.toContain(fixture.password);
    expect(credential?.passwordHash.startsWith("scrypt$")).toBe(true);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user!.id));
    expect(membership?.role).toBe("owner");
  });

  test("un indirizzo già registrato è segnalato sul campo email", async ({ page }) => {
    const fixture = makeFixture("duplicato");
    created.push(fixture);

    for (const attempt of [0, 1]) {
      await page.goto("/registrati");
      await page.fill("#organizationName", fixture.organizationName);
      // Il secondo tentativo cambia lo slug: altrimenti a fallire sarebbe
      // quello, e il test non direbbe nulla sull'indirizzo.
      await page.fill("#organizationSlug", `${fixture.organizationSlug}-${attempt}`);
      await page.fill("#name", fixture.personName);
      await page.fill("#email", fixture.email);
      await page.fill("#password", fixture.password);
      await page.click('button[type="submit"]');

      if (attempt === 0) await page.waitForURL("**/organizzazione");
    }

    await expect(page.getByText("Esiste già un account con questo indirizzo.")).toBeVisible();
    await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");

    await removeFixture({
      ...fixture,
      organizationSlug: `${fixture.organizationSlug}-0`,
    });
  });

  test("un identificativo azienda già in uso è segnalato sul proprio campo", async ({
    page,
  }) => {
    const first = makeFixture("slug-primo");
    const second = makeFixture("slug-secondo");
    created.push(first, second);

    await page.goto("/registrati");
    await page.fill("#organizationName", first.organizationName);
    await page.fill("#organizationSlug", first.organizationSlug);
    await page.fill("#name", first.personName);
    await page.fill("#email", first.email);
    await page.fill("#password", first.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/organizzazione");

    await page.goto("/registrati");
    await page.fill("#organizationName", second.organizationName);
    await page.fill("#organizationSlug", first.organizationSlug);
    await page.fill("#name", second.personName);
    await page.fill("#email", second.email);
    await page.fill("#password", second.password);
    await page.click('button[type="submit"]');

    await expect(
      page.getByText("Questo identificativo è già utilizzato. Scegline un altro."),
    ).toBeVisible();
  });

  test("l'area riservata è chiusa senza sessione", async ({ page }) => {
    await page.goto("/organizzazione");
    await expect(page).toHaveURL(/\/accedi/);
  });

  test("uscire chiude davvero la sessione", async ({ page }) => {
    const fixture = makeFixture("uscita");
    created.push(fixture);

    await page.goto("/registrati");
    await page.fill("#organizationName", fixture.organizationName);
    await page.fill("#organizationSlug", fixture.organizationSlug);
    await page.fill("#name", fixture.personName);
    await page.fill("#email", fixture.email);
    await page.fill("#password", fixture.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/organizzazione");

    await page.getByRole("button", { name: "Esci" }).click();
    await page.waitForURL("**/");

    await page.goto("/organizzazione");
    await expect(page).toHaveURL(/\/accedi/);
  });

  test("una password sbagliata non dice quale dei due campi lo è", async ({ page }) => {
    const fixture = makeFixture("accesso");
    created.push(fixture);

    await page.goto("/registrati");
    await page.fill("#organizationName", fixture.organizationName);
    await page.fill("#organizationSlug", fixture.organizationSlug);
    await page.fill("#name", fixture.personName);
    await page.fill("#email", fixture.email);
    await page.fill("#password", fixture.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/organizzazione");
    await page.getByRole("button", { name: "Esci" }).click();

    await page.goto("/accedi");
    await page.fill("#email", fixture.email);
    await page.fill("#password", "password-completamente-sbagliata");
    await page.click('button[type="submit"]');

    const message = page.getByRole("alert").getByText("Indirizzo email o password non corretti.");
    await expect(message).toBeVisible();

    // Un indirizzo inesistente deve ricevere esattamente la stessa risposta:
    // distinguerli trasformerebbe il modulo in un elenco di chi è registrato.
    await page.goto("/accedi");
    await page.fill("#email", "nessuno-qui@example.invalid");
    await page.fill("#password", "password-completamente-sbagliata");
    await page.click('button[type="submit"]');
    await expect(
      page.getByRole("alert").getByText("Indirizzo email o password non corretti."),
    ).toBeVisible();

    // E le credenziali giuste devono continuare a funzionare.
    await page.goto("/accedi");
    await page.fill("#email", fixture.email);
    await page.fill("#password", fixture.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/organizzazione");
    await expect(page.getByText(fixture.organizationName)).toBeVisible();
  });
});
