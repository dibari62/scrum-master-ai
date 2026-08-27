import { expect, test } from "@playwright/test";

/**
 * Interruzioni contro aggiunte volute.
 *
 * > «We've had three **unplanned items**, as you can see down to the right.
 * > This is useful to remember when you do the sprint retrospective.» (pag. 60)
 *
 * Il libro tiene le interruzioni in un'area a sé sulla lavagna, e la
 * retrospettiva ha una voce apposita — «Too many external disturbances»
 * (pag. 89). La proprietà che questa suite difende è che il portale **non
 * scelga** al posto della fonte: quando nessuno ha dichiarato il motivo, deve
 * dirlo invece di far passare l'aggiunta per voluta.
 *
 * In sola lettura: usa il progetto seminato e non scrive nulla.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("interruzioni a sprint iniziato", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
    await page.goto(`/progetti/${PROJECT}`);
  });

  test("il lavoro aggiunto dice quanto era un'interruzione", async ({ page }) => {
    const body = await page.locator("main").innerText();

    expect(body).toContain("Lavoro aggiunto dopo l'inizio");
    // Il totale da solo non distingue una squadra che ha accettato altro
    // lavoro da una che è stata interrotta: sono due conversazioni diverse.
    expect(body).toMatch(/interruzion[ei]/);
  });

  test("ciò che la fonte non dichiara viene detto, non dato per voluto", async ({ page }) => {
    /*
     * `null` su un evento di perimetro significa «la fonte non ha un campo per
     * dirlo», che è lo stato normale di Jira e GitHub. Farlo passare per
     * «voluta» nasconderebbe le interruzioni proprio dove sono più difficili
     * da vedere — e una squadra leggerebbe un numero rassicurante e falso.
     */
    const body = await page.locator("main").innerText();

    expect(body).toMatch(/non lo dichiara|Nessuno dichiara/);
  });

  test("il numero e il verbo concordano", async ({ page }) => {
    const body = await page.locator("main").innerText();

    // «1 non lo dichiarano» fa sembrare generato un testo che invece è scritto.
    expect(body).not.toMatch(/\b1 non lo dichiarano\b/);
    expect(body).not.toMatch(/\b1 sono interruzioni\b/);
  });
});
