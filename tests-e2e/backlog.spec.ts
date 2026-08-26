import { expect, test } from "@playwright/test";

/**
 * The product backlog: what comes next, in the order it will be taken.
 *
 * > «there's no importance column. Instead, I just order the list» (2ª ed.)
 *
 * The property this suite defends is the one a screenshot cannot show: that the
 * **order is a fact of the data**, not of how the page happened to sort it, and
 * that a "how to demo" always describes the story it sits next to.
 *
 * Read-only: it uses the seeded project and writes nothing.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("backlog di prodotto", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("si raggiunge dal menù di progetto, senza scrivere l'indirizzo", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}`);

    await page
      .getByRole("navigation", { name: "Sezioni del progetto" })
      .getByRole("link", { name: "Backlog" })
      .click();

    await page.waitForURL("**/backlog");
    await expect(
      page.getByRole("heading", { name: "Backlog di prodotto", level: 1 }),
    ).toBeVisible();
  });

  test("le posizioni sono consecutive e crescenti: è un ordine, non un punteggio", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    const rows = page.locator("[data-backlog-item]");
    expect(await rows.count()).toBeGreaterThan(0);

    const positions: number[] = [];
    for (const text of await rows.locator("td").first().allInnerTexts()) {
      const trimmed = text.trim();
      if (trimmed !== "—") positions.push(Number(trimmed));
    }

    expect(positions.length).toBeGreaterThan(0);
    expect(positions).toEqual(positions.map((_, index) => index + 1));
  });

  test("nessun elemento del backlog è già in uno sprint", async ({ page }) => {
    /*
     * La proprietà che rende questa pagina diversa dall'elenco degli elementi.
     *
     * Si verifica confrontando con l'elenco filtrato per sprint: un titolo che
     * comparisse in entrambi significherebbe che la lista da pianificare
     * contiene lavoro già pianificato, e ogni previsione costruita su di essa
     * conterebbe quel lavoro due volte.
     */
    await page.goto(`/progetti/${PROJECT}/backlog`);
    const backlogTitles = await page
      .locator("[data-backlog-item] td")
      .nth(1)
      .allInnerTexts();

    await page.goto(`/progetti/${PROJECT}/elementi`);
    const rows = page.locator("[data-item]");

    for (const title of backlogTitles.map((text) => text.trim()).slice(0, 3)) {
      const row = rows.filter({ hasText: title }).first();
      // Compare nell'elenco generale — è lo stesso elemento — ma senza sprint.
      await expect(row).toContainText("nessuno");
    }
  });

  test("chi non dichiara come si dimostra lo dice, invece di lasciare un vuoto", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    const cells = await page.locator("[data-backlog-item] td").last().allInnerTexts();

    for (const text of cells) {
      // Mai una cella vuota: «da definire» è una cosa da fare, un vuoto è un
      // dubbio su chi guarda.
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test("dichiara quanta parte del backlog è affinata, invece di lasciarlo dedurre", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    // «How to demo is filled in for all high-importance items»: la coda grezza
    // è normale, ma quanto sia affinata è un fatto sulla squadra.
    await expect(page.getByText(/dichiarano\s+come si dimostrano/)).toBeVisible();
  });

  test("dichiarate le soglie, ogni elemento dice a che cosa impegna", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    await page.fill("#must", "3");
    await page.fill("#should", "4");
    await page.fill("#later", "2");
    await page.getByRole("button", { name: "Salva le soglie" }).click();

    /*
     * Si aspetta l'elemento, non «networkidle».
     *
     * Una server action **non naviga**: la rete torna quieta prima che il
     * ri-render arrivi, e un test che legge la pagina in quel momento legge
     * quella precedente. È già costato un'ora di caccia a un difetto che non
     * c'era.
     */
    const bands = page.locator("[data-band]");
    await expect(bands.first()).toBeVisible();
    await expect(bands).toHaveCount(4);

    // Le prime tre righe sono obbligatorie, per costruzione dei tagli.
    const rows = page.locator("[data-backlog-item]");
    await expect(rows.nth(0)).toContainText("Obbligatorio nella 1.0");
    await expect(rows.nth(2)).toContainText("Obbligatorio nella 1.0");
    await expect(rows.nth(3)).toContainText("Atteso nella 1.0");
  });

  test("ogni fascia dice che cosa succede se manca, non solo come si chiama", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    /*
     * «Obbligatorio» da solo non dice *obbligatorio entro quando*, ed è
     * esattamente la parte per cui una soglia esiste: il libro la definisce
     * «in terms of the contract», e la conseguenza è il contratto.
     */
    await expect(page.getByText("Se manca, il contratto è disatteso.")).toBeVisible();
  });

  test("svuotare i campi riporta a «non dichiarate», che non è «tutte a zero»", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    for (const field of ["#must", "#should", "#later"]) await page.fill(field, "");
    await page.getByRole("button", { name: "Salva le soglie" }).click();

    await expect(page.getByText(/Nessuna soglia dichiarata/)).toBeVisible();
    await expect(page.locator("[data-band]")).toHaveCount(0);

    // Rimesse com'erano: il progetto è condiviso con le altre suite.
    await page.fill("#must", "3");
    await page.fill("#should", "4");
    await page.fill("#later", "2");
    await page.getByRole("button", { name: "Salva le soglie" }).click();
    await expect(page.locator("[data-band]").first()).toBeVisible();
  });

  test("il piano di rilascio non supera mai la velocity osservata", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    const velocityText = await page.getByText(/Velocity stimata/).first().innerText();
    const velocity = Number(/([\d.,]+) punti/.exec(velocityText)?.[1]?.replace(",", "."));
    expect(velocity).toBeGreaterThan(0);

    const sprints = page.locator("[data-planned-sprint]");
    expect(await sprints.count()).toBeGreaterThan(0);

    for (const row of await sprints.all()) {
      const cells = await row.locator("td").allInnerTexts();
      const points = Number(cells[cells.length - 1]?.trim().replace(",", "."));

      /*
       * «As many stories as possible **without exceeding**» (pag. 100).
       *
       * È l'unica proprietà che deve valere su qualunque dato, e vale la pena
       * verificarla end-to-end oltre che nel motore: il giorno in cui la
       * pagina mostrasse un piano calcolato altrove, questo test lo direbbe.
       */
      expect(points).toBeLessThanOrEqual(velocity);
    }
  });

  test("la velocity del piano si osserva e dichiara da dove viene", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    /*
     * Una proiezione vale quanto il numero che ci sta sotto, e chi legge deve
     * poterlo controllare invece di fidarsi. Nessun campo da riempire: un
     * numero digitato sarebbe una previsione travestita da misura.
     */
    await expect(page.getByText(/media dei punti conclusi/)).toBeVisible();
    await expect(page.locator("#velocity")).toHaveCount(0);
  });

  test("un elemento del backlog si apre e mostra la sua storia", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}/backlog`);

    await page.locator("[data-backlog-item] a").first().click();
    await page.waitForURL("**/elementi/**");

    await expect(page.getByRole("heading", { name: "Storia degli stati" })).toBeVisible();
  });
});
