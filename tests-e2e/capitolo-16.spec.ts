import { expect, test } from "@playwright/test";

/**
 * Il capitolo 16: la checklist dello Scrum Master, e la pagina informativa
 * dello sprint che essa nomina come primo passo.
 *
 * > «Nice little checklist. Although over time, as Scrum master, try to make
 * > yourself **redundant**. Coach the team to do these things without you.»
 * > (pag. 163)
 *
 * La proprietà che questa suite difende non è che le spunte siano giuste — su
 * quello ci sono i test del motore — ma che il portale **non finga di sapere**
 * ciò che non può sapere. Metà delle voci riguarda riunioni, conversazioni e un
 * foglio appeso a un muro: spuntarle da sole sarebbe una bugia, ometterle
 * farebbe sembrare il mestiere dello Scrum Master più piccolo di quanto sia.
 *
 * In sola lettura: usa il progetto seminato e non scrive nulla.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("checklist dello Scrum Master", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
    await page.goto(`/progetti/${PROJECT}/sprint`);
  });

  test("ogni sprint porta le quattordici voci del capitolo 16", async ({ page }) => {
    await page.locator("summary").first().click();

    const entries = page.locator("details[open] [data-checklist-entry]");
    await expect(entries).toHaveCount(14);
  });

  test("le voci che nessun dato registra restano visibili, marcate come umane", async ({
    page,
  }) => {
    await page.locator("summary").first().click();

    /*
     * È il punto dell'intera schermata. Un portale che spuntasse «il daily
     * scrum inizia in orario» starebbe mentendo; uno che la togliesse
     * lascerebbe credere che il lavoro dello Scrum Master sia solo ciò che un
     * database vede.
     */
    const human = page.locator('details[open] [data-checklist-entry="human"]');

    expect(await human.count()).toBeGreaterThan(0);
    await expect(page.locator("details[open]")).toContainText(
      "Stampare la pagina e appenderla",
    );
  });

  test("ogni voce dice anche perché, non solo se", async ({ page }) => {
    await page.locator("summary").first().click();

    // Una spunta senza motivo non si può controllare: chi legge deve poter
    // risalire al fatto invece di fidarsi.
    for (const text of await page
      .locator("details[open] [data-checklist-entry]")
      .allInnerTexts()) {
      expect(text).toContain("—");
    }
  });

  test("il riassunto conta solo ciò che è verificabile", async ({ page }) => {
    /*
     * Mettere nel denominatore anche le voci umane produrrebbe un «4 su 14»
     * che si legge come una squadra indietro, mentre le dieci restanti non
     * sono in ritardo: nessun database sa se siano state fatte.
     */
    const summary = await page.locator("summary").first().innerText();

    expect(summary).toContain("verificabili");
    expect(summary).not.toMatch(/su 14/);
  });

  test("il numero e il sostantivo concordano", async ({ page }) => {
    await page.locator("summary").first().click();

    const body = await page.locator("details[open]").first().innerText();
    expect(body).not.toMatch(/\b1 impedimenti\b/);
  });
});

test.describe("pagina informativa dello sprint", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");

    await page.goto(`/progetti/${PROJECT}/sprint`);
    await page.getByRole("link", { name: "Pagina informativa dello sprint" }).first().click();
    await page.waitForURL("**/sprint/**");
  });

  test("apre con l'obiettivo, che è la ragione per cui esiste", async ({ page }) => {
    /*
     * > «It is important to keep the whole company informed about what is going
     * > on. Otherwise, people will complain or, even worse, **make false
     * > assumptions**.» (pag. 52)
     *
     * Chi passa davanti a un foglio appeso al muro legge il titolo e
     * l'obiettivo, e basta.
     */
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const header = await page.locator("main header").innerText();
    expect(header.length).toBeGreaterThan(0);
  });

  test("elenca gli elementi con come si dimostrano", async ({ page }) => {
    const rows = page.locator("[data-sprint-item]");

    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    // «Sometimes we include info about how each story will be demonstrated».
    await expect(page.locator("main")).toContainText("Come si dimostra");
  });

  test("dichiara di essere generata, invece di sembrare scritta a mano", async ({ page }) => {
    /*
     * È l'unica cosa in cui questa versione batte quella di carta, e vale la
     * pena dirla: una pagina scritta una volta descrive lo sprint com'era quel
     * giorno, e uno sprint che si muove la rende silenziosamente falsa.
     */
    await expect(page.locator("main")).toContainText("generata dai dati");
  });

  test("uno sprint inesistente porta a una pagina non trovata, non a un errore", async ({
    page,
  }) => {
    const response = await page.goto(
      `/progetti/${PROJECT}/sprint/00000000-0000-4000-8000-000000000000`,
    );

    expect(response?.status()).toBe(404);
  });
});
