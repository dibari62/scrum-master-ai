import { expect, test } from "@playwright/test";

/**
 * The formulas page: what it must keep saying.
 *
 * **Why this needs a test at all.** The page renders `METRIC_CATALOG`, which is
 * already guarded — `catalog.test.ts` fails when a metric loses its entry or
 * cites a test that does not exist. What no unit test can check is whether the
 * page is *reachable* and whether the fields actually reach the screen: a
 * rendering bug that silently drops the edge cases would leave a page that looks
 * complete and answers nothing.
 *
 * The reachability check is not ceremony. A page reachable only by typing its
 * address is a dead end, and this project has shipped one before:
 * `/organizzazione` announced that projects were coming while they already
 * existed, and offered no link to them.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

test.describe("pagina delle formule", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("si raggiunge dal catalogo delle metriche, senza scrivere l'indirizzo", async ({ page }) => {
    await page.goto("/metriche");

    await page.getByRole("link", { name: "Le formule dei calcoli" }).click();
    await page.waitForURL("**/metriche/formule");

    await expect(page.getByRole("heading", { name: "Le formule dei calcoli" })).toBeVisible();
  });

  test("da lì si torna al catalogo", async ({ page }) => {
    await page.goto("/metriche/formule");

    await page.getByRole("navigation", { name: "Percorso" })
      .getByRole("link", { name: "Metriche" })
      .click();
    await page.waitForURL("**/metriche");
  });

  test("ogni metrica dice fra quali istanti misura, o su cosa", async ({ page }) => {
    await page.goto("/metriche/formule");
    await page.waitForLoadState("networkidle");

    // Il difetto da impedire: una scheda che mostra il nome e nient'altro,
    // perché il campo è stato aggiunto allo schema e non alla pagina.
    const cards = page.locator("main [id]");
    const count = await cards.count();
    expect(count).toBeGreaterThan(10);

    const missing: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const text = await card.innerText();

      const declaresWhen =
        text.includes("Fra quali due istanti") ||
        text.includes("In quale istante") ||
        text.includes("Su quale tratto di storia");

      if (!declaresWhen) missing.push((await card.getAttribute("id")) ?? "?");
      if (!text.includes("Da quali dati parte")) missing.push(`${await card.getAttribute("id")} (input)`);
      if (!text.includes("Casi limite")) missing.push(`${await card.getAttribute("id")} (casi limite)`);
    }

    expect(missing, `schede incomplete: ${missing.join(", ")}`).toEqual([]);
  });

  test("ogni caso limite cita il test che lo dimostra", async ({ page }) => {
    await page.goto("/metriche/formule");
    await page.waitForLoadState("networkidle");

    // È il legame che impedisce alla pagina di diventare un elenco di promesse.
    const citations = page.getByText("Verificato dal test");
    expect(await citations.count()).toBeGreaterThan(20);
  });

  test("il cycle time dichiara che entrambi gli estremi sono i primi passaggi", async ({
    page,
  }) => {
    await page.goto("/metriche/formule");

    // Misurare fino all'ultima chiusura invece che alla prima trasformerebbe la
    // rilavorazione in lentezza: è l'errore che questa pagina esiste per rendere
    // impossibile da commettere in silenzio.
    const card = page.locator("#cycle-time");

    await expect(card).toContainText("primo ingresso in «in lavorazione»");
    await expect(card).toContainText("primo ingresso in «concluso»");
  });
});
