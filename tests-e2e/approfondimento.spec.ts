import { expect, test } from "@playwright/test";

/**
 * Walking from a figure on the dashboard down to the history that produced it.
 *
 * **Why this matters more than it looks.** The dashboard claims a median cycle
 * time over 44 items. Until these screens existed the claim had to be taken on
 * trust: there was no way to see which items, or how the figure arose. This
 * suite checks the chain is unbroken — and, crucially, that the number of items
 * behind a metric matches the denominator printed on it. A card reading "su 44
 * elementi" that opens a list of 51 would be worse than no link at all.
 *
 * Read-only: it uses the seeded project and creates nothing, so unlike the other
 * end-to-end suites it has no fixture to clean up.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

/** The project the seed connector populates. */
const PROJECT = "checkout";

test.describe("approfondimento dei numeri", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("il denominatore di una metrica corrisponde agli elementi che apre", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}`);

    const card = page.getByRole("link", { name: /Cycle time mediano/ }).first();
    const detail = await card.innerText();

    // "su 44 elementi" → 44
    const declared = /su (\d+) element/.exec(detail)?.[1];
    expect(declared, "il riquadro deve dichiarare quanti elementi ha contato").toBeDefined();

    await card.click();
    await page.waitForURL("**/elementi**");

    /*
     * `[data-item]`, non «le righe di una tabella dentro main».
     *
     * Su questa pagina può comparire anche la tabella delle stime fuori scala,
     * e sommare i due elenchi darebbe un numero che non è il denominatore di
     * nessuna metrica. La proprietà verificata non cambia: il numero scritto
     * sul riquadro deve corrispondere a quanti elementi apre.
     */
    const listed = await page.locator("[data-item]").count();
    expect(
      listed,
      "gli elementi elencati devono essere quelli contati dalla metrica",
    ).toBe(Number(declared));
  });

  test("da un elemento si vede la storia da cui esce il suo cycle time", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/elementi?conclusi=1`);
    await page.locator("[data-item] a").first().click();
    await page.waitForURL("**/elementi/**");

    await expect(page.getByRole("heading", { name: "Storia degli stati" })).toBeVisible();

    // Almeno un passaggio in lavorazione: senza, il cycle time non esisterebbe
    // e la pagina starebbe mostrando un numero senza fondamento.
    // Selezionata per nome accessibile, non per nome di tag: quando le
    // briciole di pane sono diventate anch'esse una lista ordinata, un
    // `locator("ol")` ha smesso di sapere quale delle due volesse.
    const timeline = page.getByRole("list", { name: "Storia degli stati" });
    await expect(timeline).toContainText("In lavorazione");

    // Il tempo di lavorazione dev'essere dichiarato come tale: e la distinzione
    // fra lavoro e coda e la decisione presa sulla questione aperta Q1.
    await expect(timeline).toContainText("lavorazione");
  });

  test("un elemento concluso non mostra una durata che continua a crescere", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/elementi?stato=done`);
    await page.locator("[data-item] a").first().click();
    await page.waitForURL("**/elementi/**");

    const last = page
      .getByRole("list", { name: "Storia degli stati" })
      .getByRole("listitem")
      .last();
    await expect(last).toContainText("Concluso");
    await expect(last).not.toContainText("adesso");
  });

  test("un identificativo inesistente porta a una pagina non trovata, non a un errore", async ({
    page,
  }) => {
    const response = await page.goto(
      `/progetti/${PROJECT}/elementi/00000000-0000-4000-8000-000000000000`,
    );

    expect(response?.status()).toBe(404);
  });

  test("un identificativo malformato non produce un errore del server", async ({ page }) => {
    // Non deve arrivare un 500: un indirizzo sbagliato e un indirizzo
    // sbagliato, non un guasto.
    const response = await page.goto(`/progetti/${PROJECT}/elementi/non-un-uuid`);

    expect(response?.status()).toBe(404);
  });
});
