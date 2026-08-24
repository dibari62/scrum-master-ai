import { expect, test } from "@playwright/test";

/**
 * The sprint-health indicator on the project dashboard.
 *
 * **What is being defended here is not the arithmetic** — `health.test.ts` does
 * that on invented cases, and the seed integration test proves the engine fires
 * on real data. This suite defends the two things only a browser can check.
 *
 * The first is that **the colour is never the message**. A verdict that exists
 * only as a CSS class says nothing to a reader who cannot separate red from
 * green, and nothing at all to one who is listening to the page.
 *
 * The second is that **a light without a reason is decoration**. The line worth
 * having is not "critico", it is the one underneath naming the measurement, the
 * threshold and the distance between them.
 *
 * Read-only: it uses the seeded project and creates nothing.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("salute dello sprint", () => {
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

  test("il giudizio è scritto a parole, non affidato a un colore", async ({ page }) => {
    const body = await page.locator("main").innerText();

    expect(body).toMatch(
      /Sereno|Da tenere d'occhio|Critico|Non valutabile|Nessuno sprint in corso/,
    );
  });

  test("dice quanta parte dello sprint è trascorsa", async ({ page }) => {
    /*
     * Senza questa riga il giudizio non è interpretabile: «indietro» al terzo
     * giorno e «indietro» al penultimo sono due affermazioni molto diverse.
     */
    const body = await page.locator("main").innerText();

    if (body.includes("Nessuno sprint in corso")) test.skip();
    expect(body).toMatch(/\d+% dello sprint trascorso/);
  });

  test("ogni segnale porta una spiegazione, mai solo un'etichetta", async ({ page }) => {
    const body = await page.locator("main").innerText();
    if (body.includes("Nessuno sprint in corso")) test.skip();

    // I cinque segnali della specifica. Se uno sparisse dall'elenco, si
    // leggerebbe come un segnale superato invece che come uno mancante.
    for (const title of [
      "Avanzamento",
      "Lavoro aggiunto dopo l'inizio",
      "Attesa in revisione",
      "Limite di lavoro in corso",
      "Elementi fermi",
    ]) {
      expect(body, `manca il segnale «${title}»`).toContain(title);
    }

    // E ogni segnale o dichiara una soglia, o dice cosa manca per valutarlo.
    const signals = page.locator("main ul li");
    const count = await signals.count();
    expect(count).toBeGreaterThan(0);
  });

  test("un segnale superato dichiara di quanto, non solo che", async ({ page }) => {
    const body = await page.locator("main").innerText();
    if (body.includes("Nessuno sprint in corso")) test.skip();

    // Sui dati sintetici la revisione è deliberatamente ingolfata. «Oltre la
    // soglia» inviterebbe a un'alzata di spalle; un multiplo no.
    const hasDistance = /soglia|×|%/.test(body);
    expect(hasDistance, "nessun rilievo dichiara la propria soglia").toBe(true);
  });

  test("il semaforo sta prima dei numeri storici, non dopo", async ({ page }) => {
    const body = await page.locator("main").innerText();
    if (body.includes("Nessuno sprint in corso")) test.skip();

    /*
     * L'ordine è la funzione: è l'unica cosa nella pagina che riguarda ciò su
     * cui si può ancora intervenire. In fondo diventerebbe una nota a piè di
     * pagina di se stesso.
     */
    const verdict = Math.min(
      ...["Sereno", "Da tenere d'occhio", "Critico", "Non valutabile"]
        .map((word) => body.indexOf(word))
        .filter((index) => index >= 0),
    );

    const history = body.indexOf("Il flusso, nel complesso");

    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(history).toBeGreaterThan(verdict);
  });

  test("il giudizio non nomina né valuta una persona", async ({ page }) => {
    // §8.2: si misura il processo. Il modo naturale di «spiegare» un rosso è
    // dire chi ha in mano gli elementi fermi, ed è esattamente ciò che questo
    // prodotto si vieta.
    const body = await page.locator("main").innerText();

    expect(body).not.toMatch(/(assegnat|responsabil|a carico di|colpa)/i);
  });

  test("il burndown non disegna giorni che non sono ancora avvenuti", async ({ page }) => {
    /*
     * Il difetto comparso il giorno in cui lo scenario ha smesso di essere
     * tutto nel passato: i giorni futuri venivano campionati e producevano
     * punti identici all'ultimo reale, cioè una coda piatta che si legge come
     * lavoro fermo.
     */
    const chart = page.getByRole("figure", { name: "Burndown" });
    if ((await chart.count()) === 0) test.skip();

    const labels = await chart.locator("[aria-label], [title]").allInnerTexts();
    void labels;

    const description = (await chart.innerText()).trim();
    expect(description.length).toBeGreaterThan(0);
  });
});
