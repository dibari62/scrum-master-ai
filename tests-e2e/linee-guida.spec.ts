import { expect, test } from "@playwright/test";

/**
 * The book's numeric guidelines, on the page that shows one sprint at a time.
 *
 * > «We normally strive for stories weighted two to eight man-days» and 5 to 15
 * > stories per sprint (pag. 43)
 *
 * The property worth defending end to end is not the numbers — those are unit
 * tested against the printed figures — but the **register**: they are warnings,
 * and a warning that reads like a verdict changes what a team does with it.
 *
 * Read-only: it uses the seeded project and writes nothing.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("linee guida di pianificazione", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
    await page.goto(`/progetti/${PROJECT}/sprint`);
  });

  test("ogni avviso dice anche il motivo, non solo il numero", async ({ page }) => {
    const notes = await page.locator("main > ul > li ul li").allInnerTexts();

    expect(notes.length).toBeGreaterThan(0);

    for (const note of notes) {
      /*
       * Il trattino lungo separa il fatto dalla sua causa probabile.
       *
       * «4 storie: sotto le 5» e' un fatto e non dice cosa farne. «— di solito
       * significa storie troppo grandi» e' la ragione per cui la soglia
       * esiste, ed e' l'unica parte che cambia il comportamento di chi legge.
       */
      expect(note).toContain("—");
    }
  });

  test("gli avvisi sono avvisi: nessuno sprint viene dichiarato invalido", async ({
    page,
  }) => {
    const text = await page.locator("main").innerText();

    /*
     * Il libro le chiama guideline e mai regole. Una parola come «errore» o
     * «non valido» accanto a uno sprint con quattro storie insegnerebbe a
     * spezzare le storie per far tornare il conteggio, che e' esattamente il
     * comportamento che la soglia dovrebbe scoraggiare.
     */
    expect(text).not.toMatch(/non valid|invalid|errore/i);
  });

  test("uno sprint dentro le linee guida non mostra rassicurazioni", async ({ page }) => {
    const text = await page.locator("main").innerText();

    /*
     * Nessun «tutto a posto».
     *
     * Un riquadro che dice che va tutto bene su ogni sprint insegna all'occhio
     * a saltare quell'area — compreso il giorno in cui avrebbe qualcosa da
     * dire. Il silenzio e' l'assenza di avvisi.
     */
    expect(text).not.toMatch(/tutto a posto|nessun problema|conforme/i);
  });

  test("il numero e il sostantivo concordano", async ({ page }) => {
    const notes = await page.locator("main > ul > li ul li").allInnerTexts();

    for (const note of notes) {
      // «1 storie» fa sembrare generato un testo che invece e' stato scritto.
      expect(note).not.toMatch(/\b1 storie\b/);
    }
  });
});
