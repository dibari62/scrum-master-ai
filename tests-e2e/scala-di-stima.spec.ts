import { expect, test } from "@playwright/test";

/**
 * The estimation scale: declared by a person, checked by code.
 *
 * > «you can't cheat by combining a 5 and a 2 to make a 7. You have to choose
 * > either 5 or 8; there is no 7» (pag. 38)
 *
 * The rule the book states most forcefully is worth an end-to-end test, because
 * the failure mode is silence: a scale nobody checks looks exactly like a scale
 * everybody follows.
 *
 * The suite **puts the scale back** when it finishes. It writes to the shared
 * seeded project, and a test that leaves a project configured differently from
 * how it found it makes the next failure impossible to read.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";
const CONFIG = `/progetti/${PROJECT}/scrum-master/configurazione`;
const ITEMS = `/progetti/${PROJECT}/elementi`;

async function declareScale(
  page: import("@playwright/test").Page,
  scale: string,
): Promise<void> {
  await page.goto(CONFIG);
  await page.selectOption("#estimationScale", scale);
  await page.getByRole("button", { name: "Cambia scala" }).click();
  await page.waitForLoadState("networkidle");
}

test.describe("scala di stima", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test.afterEach(async ({ page }) => {
    // Si rimette com'era: il progetto è condiviso con le altre suite.
    await declareScale(page, "free");
  });

  test("senza scala dichiarata gli elementi non parlano di scala", async ({ page }) => {
    await declareScale(page, "free");
    await page.goto(ITEMS);

    await expect(page.getByRole("heading", { name: /Scala di stima/ })).toHaveCount(0);
  });

  test("dichiarata una scala, le deviazioni compaiono con i valori ammessi vicini", async ({
    page,
  }) => {
    await declareScale(page, "planning-poker");
    await page.goto(ITEMS);

    await expect(
      page.getByRole("heading", { name: /Scala di stima · Planning poker/ }),
    ).toBeVisible();

    /*
     * Il numero non è fissato, la proprietà sì.
     *
     * Quante stime siano fuori scala dipende dai dati del seed, e inchiodare un
     * «5 su 44» renderebbe questo test un allarme ogni volta che qualcuno
     * cambia lo scenario. Ciò che deve valere sempre è che ogni deviazione dica
     * fra quali due carte sta.
     */
    const summary = page.getByText(/non stanno sulla scala dichiarata/);
    await expect(summary).toBeVisible();

    const rows = page.locator("main table").first().locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);

    for (const text of await rows.allInnerTexts()) {
      // «3 o 5», oppure la dichiarazione esplicita che sopra non c'è nulla.
      expect(text).toMatch(/\d+([.,]\d+)?\s+o\s+\d+([.,]\d+)?|nessuno sopra/);
    }
  });

  test("la scala scelta si rilegge sulla scheda, non solo al momento del salvataggio", async ({
    page,
  }) => {
    await declareScale(page, "fibonacci");

    await page.goto(CONFIG);
    await expect(page.getByText("Scala di stima · Fibonacci")).toBeVisible();
  });

  test("il portale segnala e non corregge: la stima resta quella della fonte", async ({
    page,
  }) => {
    await declareScale(page, "planning-poker");
    await page.goto(ITEMS);

    const first = page.locator("main table").first().locator("tbody tr").first();
    const title = (await first.locator("td").first().innerText()).trim();

    /*
     * La proprietà che vale la pena difendere.
     *
     * Una segnalazione che «aggiusta» la stima cancellerebbe il dato della
     * fonte, e la prossima importazione lo rimetterebbe: si vedrebbero numeri
     * che cambiano da soli. L'elemento deve comparire nell'elenco generale con
     * la stessa stima con cui è stato segnalato.
     */
    const offScaleValue = (await first.locator("td").nth(1).innerText()).trim();

    const generalRow = page
      .locator("main table")
      .last()
      .locator("tbody tr")
      .filter({ hasText: title })
      .first();

    await expect(generalRow).toContainText(offScaleValue);
  });
});
