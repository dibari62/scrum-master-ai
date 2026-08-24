import { expect, test } from "@playwright/test";

/**
 * The kept history of the sprint's health.
 *
 * **What this covers that nothing else can.** Every other figure in the
 * application is computed when somebody looks. This one exists only because a
 * scheduled run wrote it down — so the test is really asking whether the
 * product can say *how something changed*, which on-demand calculation can
 * never answer.
 *
 * It is deliberately tolerant about how many checks exist: on a fresh database
 * there may be none, and the screen has three honest answers depending on the
 * count. Asserting one of them would make the suite depend on how many days ago
 * somebody last ran the job.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("storia della salute dello sprint", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");

    await page.goto(`/progetti/${PROJECT}`);
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("la sezione esiste e spiega a cosa serve", async ({ page }) => {
    const body = await page.locator("main").innerText();

    expect(body).toContain("Come è cambiato negli ultimi giorni");
    // Il motivo per cui la sezione esiste, non solo il suo titolo.
    expect(body).toMatch(/controllo automatico/);
  });

  test("dichiara onestamente quando non c'è ancora un andamento", async ({ page }) => {
    /*
     * Tre risposte oneste a seconda di quanti controlli esistono. Con un punto
     * solo non c'è un andamento, e disegnarlo suggerirebbe una stabilità che
     * nessuno ha osservato.
     */
    const body = await page.locator("main").innerText();

    const nessuno = body.includes("Nessun controllo automatico ancora eseguito");
    const unoSolo = body.includes("Un solo controllo finora");
    const andamento = body.includes("Un controllo al giorno.");

    expect(
      [nessuno, unoSolo, andamento].filter(Boolean),
      "la sezione non dichiara in quale dei tre stati si trova",
    ).toHaveLength(1);
  });

  test("sta sotto il semaforo, non sopra", async ({ page }) => {
    // Prima si legge come sta adesso, poi da quanto: l'ordine inverso
    // chiederebbe di interpretare una storia prima di sapere di cosa.
    const body = await page.locator("main").innerText();

    const semaforo = Math.min(
      ...["Sereno", "Da tenere d'occhio", "Critico", "Non valutabile"]
        .map((parola) => body.indexOf(parola))
        .filter((index) => index >= 0),
    );

    const storia = body.indexOf("Come è cambiato negli ultimi giorni");

    if (storia < 0) test.skip();
    expect(storia).toBeGreaterThan(semaforo);
  });

  test("il giudizio di ogni giorno è scritto, non affidato a un colore", async ({
    page,
  }) => {
    const body = await page.locator("main").innerText();
    if (!body.includes("Un controllo al giorno.")) test.skip();

    expect(body).toMatch(/Sereno|Da tenere d'occhio|Critico|Non valutabile/);
  });
});
