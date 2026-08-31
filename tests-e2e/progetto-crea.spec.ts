import { expect, test, type Page } from "@playwright/test";

import { makeFixture, removeFixture, type Fixture } from "./fixtures";

/**
 * Creating a project from the interface.
 *
 * Until this existed, `createProject` was called only by tests: a company that
 * registered today landed in an area with no projects and no way to make one —
 * the same dead end this project already shipped once with `/organizzazione`.
 *
 * These tests write to a real database, so they are opt-in like the rest of the
 * suite, and each one cleans up exactly the rows it created.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

async function register(page: Page, fixture: Fixture): Promise<void> {
  await page.goto("/registrati");
  await page.fill("#organizationName", fixture.organizationName);
  await page.fill("#organizationSlug", fixture.organizationSlug);
  await page.fill("#name", fixture.personName);
  await page.fill("#email", fixture.email);
  await page.fill("#password", fixture.password);
  await page.getByRole("button", { name: "Crea l'account" }).click();
  await page.waitForURL("**/organizzazione");
}

async function signIn(page: Page, fixture: Fixture): Promise<void> {
  await page.goto("/accedi");
  await page.fill("#email", fixture.email);
  await page.fill("#password", fixture.password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL("**/organizzazione");
}

async function signOut(page: Page): Promise<void> {
  await page.goto("/progetti");
  await page.getByRole("button", { name: "Esci" }).click();
  await page.waitForURL("**/");
}

/** Fills the creation form and submits it. Assumes the page is already on it. */
async function fillProject(
  page: Page,
  project: { readonly name: string; readonly slug: string; readonly description?: string },
): Promise<void> {
  await page.fill("#name", project.name);
  await page.fill("#slug", project.slug);
  if (project.description !== undefined) {
    await page.fill("#description", project.description);
  }
  await page.getByRole("button", { name: "Crea il progetto" }).click();
}

test.describe("creazione di un progetto", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test scrivono su un database reale");

  const created: Fixture[] = [];

  test.afterAll(async () => {
    // L'organizzazione cade in cascata sui suoi progetti: due delete bastano.
    for (const fixture of created) await removeFixture(fixture);
    created.length = 0;
  });

  test("dall'elenco vuoto si crea un progetto e si arriva alla sua dashboard", async ({
    page,
  }) => {
    const fixture = makeFixture("crea-progetto");
    created.push(fixture);

    await register(page, fixture);

    await page.getByRole("link", { name: "Vai ai progetti" }).click();
    await page.waitForURL("**/progetti");

    /*
     * Lo stato vuoto è la prima schermata di un'azienda nuova: deve dire cosa
     * fare, non mostrare un elenco vuoto. Prima invitava a eseguire `npm run
     * seed`, un comando da terminale che chi si è registrato dal browser non ha
     * modo di eseguire.
     */
    await expect(page.getByText("Nessun progetto, per ora")).toBeVisible();

    // Il punto: un pulsante, non un indirizzo da indovinare.
    await page.getByRole("link", { name: "Crea il primo progetto" }).click();
    await page.waitForURL("**/progetti/crea");

    await page.fill("#name", "Piattaforma di Checkout");

    // L'identificativo segue il nome, come nella registrazione azienda.
    await expect(page.locator("#slug")).toHaveValue("piattaforma-di-checkout");

    const slug = `e2e-${fixture.organizationSlug}-checkout`;
    await fillProject(page, {
      name: "Piattaforma di Checkout",
      slug,
      description: "Il flusso di pagamento del negozio.",
    });

    /*
     * Si atterra **nel progetto**, non sull'elenco.
     *
     * E la prima cosa che deve dire è che cosa fare: un progetto appena creato
     * non ha dati, quindi ogni metrica è vuota. Senza i primi passi la
     * schermata è indistinguibile da un guasto.
     */
    await page.waitForURL(`**/progetti/${slug}`);
    await expect(
      page.getByRole("heading", { name: "Piattaforma di Checkout", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /i dati no/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Collega una fonte dati" })).toBeVisible();

    // E il progetto compare nell'elenco, che è la conferma per chi torna dopo.
    await page.goto("/progetti");
    await expect(page.getByText("Piattaforma di Checkout")).toBeVisible();
    await expect(page.getByText("Il flusso di pagamento del negozio.")).toBeVisible();
  });

  test("l'identificativo segue il nome finché non lo si modifica a mano", async ({
    page,
  }) => {
    const fixture = makeFixture("slug-progetto");
    created.push(fixture);

    await register(page, fixture);
    await page.goto("/progetti/crea");

    await page.fill("#name", "Città Metropolitana à Responsabilità");
    await expect(page.locator("#slug")).toHaveValue("citta-metropolitana-a-responsabilita");

    // Una volta scelto a mano, l'identificativo non deve più cambiare da solo.
    await page.fill("#slug", "scelto-a-mano");
    await page.fill("#name", "Nome Completamente Diverso");
    await expect(page.locator("#slug")).toHaveValue("scelto-a-mano");
  });

  test("un identificativo già usato nella stessa azienda è segnalato sul proprio campo", async ({
    page,
  }) => {
    const fixture = makeFixture("slug-doppio");
    created.push(fixture);

    await register(page, fixture);

    const slug = `e2e-${fixture.organizationSlug}-doppio`;

    await page.goto("/progetti/crea");
    await fillProject(page, { name: "Primo progetto", slug });
    await page.waitForURL(`**/progetti/${slug}`);

    await page.goto("/progetti/crea");
    await fillProject(page, { name: "Secondo progetto", slug });

    await expect(
      page.getByText(
        "Questo identificativo è già usato da un altro progetto della tua azienda. Scegline un altro.",
      ),
    ).toBeVisible();
    await expect(page.locator("#slug")).toHaveAttribute("aria-invalid", "true");

    // Il nome inserito non si perde: si corregge il campo sbagliato, non tutto.
    await expect(page.locator("#name")).toHaveValue("Secondo progetto");
  });

  test("un identificativo non valido è rifiutato senza svuotare il modulo", async ({
    page,
  }) => {
    const fixture = makeFixture("slug-invalido");
    created.push(fixture);

    await register(page, fixture);
    await page.goto("/progetti/crea");

    // `novalidate` non c'è: si aggira il controllo del browser scrivendo un
    // valore che il pattern del dominio rifiuta ma l'HTML accetta.
    await fillProject(page, { name: "Progetto con spazi", slug: "non valido" });

    await expect(page.locator("#slug")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#name")).toHaveValue("Progetto con spazi");
  });

  test("due aziende diverse possono avere lo stesso identificativo, e ognuna vede solo il proprio", async ({
    page,
  }) => {
    const first = makeFixture("tenant-a");
    const second = makeFixture("tenant-b");
    created.push(first, second);

    /*
     * Il vincolo di unicità è sulla coppia (organizzazione, identificativo).
     * Due aziende devono poter avere entrambe un progetto «checkout» senza
     * vedersi: è §8.4 osservata dall'esterno, dove conta.
     */
    const shared = `e2e-condiviso-${first.organizationSlug.slice(-8)}`;
    const nameA = `Checkout di ${first.organizationName}`;
    const nameB = `Checkout di ${second.organizationName}`;

    await register(page, first);
    await page.goto("/progetti/crea");
    await fillProject(page, { name: nameA, slug: shared });
    await page.waitForURL(`**/progetti/${shared}`);
    await expect(page.getByRole("heading", { name: nameA, level: 1 })).toBeVisible();

    await signOut(page);

    await register(page, second);
    await page.goto("/progetti/crea");
    await fillProject(page, { name: nameB, slug: shared });

    // Nessun errore di unicità: lo stesso identificativo è libero qui, e lo
    // stesso indirizzo apre due progetti diversi, uno per azienda.
    await page.waitForURL(`**/progetti/${shared}`);
    await expect(page.getByRole("heading", { name: nameB, level: 1 })).toBeVisible();

    await page.goto("/progetti");
    await expect(page.getByText(nameB)).toBeVisible();
    await expect(page.getByText(nameA)).toHaveCount(0);

    await signOut(page);
    await signIn(page, first);

    await page.goto("/progetti");
    await expect(page.getByText(nameA)).toBeVisible();
    await expect(page.getByText(nameB)).toHaveCount(0);

    await page.goto(`/progetti/${shared}`);
    await expect(page.getByRole("heading", { name: nameA, level: 1 })).toBeVisible();
  });
});
