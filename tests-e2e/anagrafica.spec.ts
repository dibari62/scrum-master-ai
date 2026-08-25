import { expect, test } from "@playwright/test";

/**
 * The two screens the canonical model had and the interface did not.
 *
 * Five people sat in the database, reachable from nowhere; sprints appeared
 * only as bars on a chart. This suite walks the path a person actually takes —
 * dashboard, click, read — because a page that exists and cannot be reached is
 * the defect this project has already shipped once.
 *
 * The second test is the one that matters most. §8.2 forbids individual
 * performance metrics, and the obvious thing to put beside a name is how many
 * items that person closed. A rule that lives only in a document is one refactor
 * away from being forgotten; asserted here, adding that column fails a build.
 *
 * Read-only: it uses the seeded project and creates nothing, so there is no
 * fixture to clean up.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

/** The project the seed connector populates. */
const PROJECT = "checkout";

test.describe("persone e sprint", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("dalla dashboard si raggiungono le persone senza scrivere l'indirizzo", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}`);

    /*
     * Il collegamento si cerca nella **barra delle sezioni**, non fra i
     * contenuti della pagina.
     *
     * Prima stava in una riga di sette pulsanti sulla sola dashboard; ora vive
     * nel layout e compare su ogni pagina del progetto. La proprietà che questo
     * test difende non è cambiata — «raggiungibile senza scrivere l'indirizzo»,
     * che questo progetto ha già violato una volta — ma il posto in cui
     * guardare sì, ed è giusto che il test lo dica.
     */
    await page
      .getByRole("navigation", { name: "Sezioni del progetto" })
      .getByRole("link", { name: "Persone" })
      .click();
    await page.waitForURL("**/persone");

    await expect(page.getByRole("heading", { name: "Persone", level: 1 })).toBeVisible();

    // Quante persone risultano nel progetto è un fatto sull'anagrafica, non su
    // qualcuno: è il solo numero che questa pagina ha il diritto di mostrare.
    await expect(page.getByText(/persone compaiono nei dati di questo progetto/)).toBeVisible();

    // Le persone del modello canonico ci sono davvero, non è una pagina vuota.
    await expect(page.locator("main ul li")).not.toHaveCount(0);
  });

  test("l'elenco delle persone non mostra numeri per persona", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}/persone`);

    // La regola resa visibile: la pagina deve dire perché non ci sono numeri.
    await expect(
      page.getByRole("heading", { name: /Perché qui non ci sono numeri per persona/ }),
    ).toBeVisible();
    await expect(page.getByText(/misura il processo, non le persone/i)).toBeVisible();

    // E deve non averli. Un conteggio di elementi accanto a un nome è
    // esattamente la metrica di performance individuale vietata da §8.2.
    const roster = page.locator("main section ul li");
    const rows = await roster.count();
    expect(rows).toBeGreaterThan(0);

    for (let index = 0; index < rows; index += 1) {
      const text = await roster.nth(index).innerText();

      expect(text, `riga ${index} contiene un conteggio per persona`).not.toMatch(
        /\d+\s*(element|punt|commit|pull request|storie)/i,
      );
      expect(text, `riga ${index} contiene una percentuale per persona`).not.toMatch(
        /\d+\s*%/,
      );
    }
  });

  test("dalla dashboard si raggiungono gli sprint, con i loro numeri", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}`);

    await page
      .getByRole("navigation", { name: "Sezioni del progetto" })
      .getByRole("link", { name: "Sprint" })
      .click();
    await page.waitForURL("**/sprint");

    await expect(page.getByRole("heading", { name: "Sprint", level: 1 })).toBeVisible();

    const first = page.locator("main ul li").first();
    const text = await first.innerText();

    // Ogni sprint dichiara quanti elementi conteneva, oppure dice che non lo
    // sa: mai uno zero muto al posto di una lacuna (`MetricResult`).
    expect(text).toMatch(/\d+ element[oi] (alla chiusura|alla data di fine|finora)|non disponibili/);

    // E porta agli elementi, così il numero si può controllare invece che
    // credere.
    await first.getByRole("link").first().click();
    await page.waitForURL("**/elementi**");
  });

  test("le briciole di pane riportano al progetto da entrambe le pagine", async ({
    page,
  }) => {
    for (const path of ["persone", "sprint"] as const) {
      await page.goto(`/progetti/${PROJECT}/${path}`);

      await page
        .getByRole("navigation", { name: "Percorso" })
        .getByRole("link", { name: "Checkout" })
        .click();

      await page.waitForURL(`**/progetti/${PROJECT}`);
    }
  });
});
