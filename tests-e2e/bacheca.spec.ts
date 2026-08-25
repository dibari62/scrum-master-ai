import { expect, test } from "@playwright/test";

/**
 * The board and the impediment register: the last two entities that had rows in
 * the database and no screen anywhere.
 *
 * The board is not decoration. It is where a team records the limit it set for
 * itself, and on the seeded project one column is over that limit — a fact the
 * dashboard could not state before this page existed.
 *
 * The test that matters most is the third: it checks that the per-column counts
 * add up to the number of items the project has. A board whose figures do not
 * reconcile with the list beside it is worse than no board, because it teaches a
 * reader to stop trusting both.
 *
 * Read-only: it uses the seeded project and creates nothing.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("flusso di lavoro e impedimenti", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("dalla dashboard si raggiunge il flusso di lavoro", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}`);

    // Nella barra delle sezioni, che ora vive nel layout: la proprietà difesa
    // è la stessa — raggiungibile senza scrivere l'indirizzo — ma il posto in
    // cui guardare è cambiato.
    await page
      .getByRole("navigation", { name: "Sezioni del progetto" })
      .getByRole("link", { name: "Flusso" })
      .click();
    await page.waitForURL("**/flusso");

    await expect(
      page.getByRole("heading", { name: "Flusso di lavoro", level: 1 }),
    ).toBeVisible();

    await expect(page.locator("main section ul li")).not.toHaveCount(0);
  });

  test("il limite di una colonna è dichiarato a parole, non solo con un colore", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}/flusso`);

    /*
     * Chi non distingue il rosso dal verde, e chi ascolta invece di guardare,
     * deve ricevere la stessa informazione. Se il superamento del limite
     * vivesse solo nella classe CSS, questa attesa fallirebbe.
     */
    const columns = page.locator("main section ul li");
    const rows = await columns.count();
    expect(rows).toBeGreaterThan(0);

    let withLimit = 0;

    for (let index = 0; index < rows; index += 1) {
      const text = await columns.nth(index).innerText();
      if (!/limite \d+/.test(text)) continue;

      withLimit += 1;
      expect(text, `la colonna ${index} dichiara un limite ma non come si colloca`).toMatch(
        /entro il limite|al limite|oltre il limite/,
      );
    }

    expect(withLimit, "nessuna colonna dichiara un limite di lavoro in corso").toBeGreaterThan(
      0,
    );
  });

  test("i conteggi delle colonne quadrano con gli elementi del progetto", async ({
    page,
  }) => {
    /*
     * Il controllo che rende la bacheca affidabile.
     *
     * Le colonne contano per stato a un istante, l'elenco conta gli elementi
     * del progetto: sono due strade diverse verso lo stesso totale. Se non
     * coincidono, o un elemento è contato due volte o uno è sparito — ed è
     * esattamente il genere di difetto che nessun test unitario vede, perché
     * nasce dal mettere insieme due letture giuste.
     */
    await page.goto(`/progetti/${PROJECT}/flusso`);

    const columns = page.locator("main section ul li");
    const rows = await columns.count();

    let onBoard = 0;
    for (let index = 0; index < rows; index += 1) {
      const text = await columns.nth(index).innerText();
      const match = text.match(/(\d+)\s+element[oi]/);
      if (match?.[1]) onBoard += Number(match[1]);
    }

    // Gli stati che nessuna colonna rappresenta sono dichiarati a parte, e
    // vanno rimessi nel totale: è proprio per questo che la pagina li mostra.
    const uncovered = page.getByRole("heading", {
      name: /Elementi in stati che nessuna colonna rappresenta/,
    });

    if (await uncovered.isVisible()) {
      const list = page.locator("main div ul li");
      const extra = await list.count();

      for (let index = 0; index < extra; index += 1) {
        const text = await list.nth(index).innerText();
        const match = text.match(/(\d+)\s+element[oi]/);
        if (match?.[1]) onBoard += Number(match[1]);
      }
    }

    await page.goto(`/progetti/${PROJECT}/elementi`);
    const heading = await page.locator("main header p").first().innerText();
    const total = Number(heading.match(/(\d+)\s+element/)?.[1] ?? "0");

    expect(total).toBeGreaterThan(0);
    expect(onBoard, "la bacheca e l'elenco non contano gli stessi elementi").toBe(total);
  });

  test("il registro degli impedimenti distingue l'ostacolo dall'elemento fermo", async ({
    page,
  }) => {
    await page.goto(`/progetti/${PROJECT}`);

    await page.getByRole("link", { name: "Impedimenti" }).click();
    await page.waitForURL("**/impedimenti");

    await expect(
      page.getByRole("heading", { name: "Impedimenti", level: 1 }),
    ).toBeVisible();

    // La distinzione è la ragione per cui la pagina esiste: se sparisce, chi
    // legge conta gli ostacoli sulla colonna «Bloccato» e ottiene un altro
    // numero.
    await expect(
      page.getByRole("heading", { name: /Un impedimento non è un elemento bloccato/ }),
    ).toBeVisible();
  });

  test("nessuna delle due pagine attribuisce qualcosa a una persona", async ({ page }) => {
    for (const path of ["flusso", "impedimenti"] as const) {
      await page.goto(`/progetti/${PROJECT}/${path}`);

      /*
       * Si aspetta che resti un solo `main`.
       *
       * Durante la transizione lo scheletro di caricamento e la pagina vera
       * convivono per un istante, ed è la pagina vera quella da leggere.
       * Prendere il primo dei due sarebbe una scommessa sull'ordine del DOM.
       */
      await expect(page.locator("main")).toHaveCount(1);

      const body = await page.locator("main").innerText();

      // §8.2: si misura il processo. Un nome accanto a un ostacolo o a una
      // colonna trasformerebbe entrambe le pagine in uno strumento di
      // valutazione.
      expect(body, `${path} sembra attribuire qualcosa a qualcuno`).not.toMatch(
        /(assegnat|responsabil|a carico di|causat[oa] da)\s+\w+/i,
      );
    }
  });

  test("le briciole di pane riportano al progetto da entrambe le pagine", async ({
    page,
  }) => {
    for (const path of ["flusso", "impedimenti"] as const) {
      await page.goto(`/progetti/${PROJECT}/${path}`);

      await page
        .getByRole("navigation", { name: "Percorso" })
        .getByRole("link", { name: "Checkout" })
        .click();

      await page.waitForURL(`**/progetti/${PROJECT}`);
    }
  });

  test("dice dove si accumula il tempo, e non solo quanti elementi ci sono", async ({
    page,
  }) => {
    /*
     * Una colonna piena e una colonna lenta sono problemi diversi, e solo il
     * secondo è un collo di bottiglia: gli elementi possono affollarsi in
     * revisione perché ne sono arrivati molti insieme, oppure perché ciascuno
     * ci resta giorni. Il conteggio delle colonne non distingue i due casi.
     */
    await page.goto(`/progetti/${PROJECT}/flusso`);
    await expect(page.locator("main")).toHaveCount(1);

    const sezione = page.getByRole("region", { name: "Dove si accumula il tempo" });
    await expect(sezione).toBeVisible();

    const testo = await sezione.innerText();

    // Sui dati sintetici la revisione è ingolfata di proposito.
    expect(testo).toMatch(/Il tempo si accumula soprattutto nella fase/);
    expect(testo).toMatch(/lavorazione vera/);
  });

  test("le quote sono scritte, non affidate alla lunghezza di una barra", async ({
    page,
  }) => {
    // La lunghezza di un rettangolo non è leggibile da chi ascolta la pagina,
    // ed è approssimativa per chiunque altro.
    await page.goto(`/progetti/${PROJECT}/flusso`);

    const sezione = page.getByRole("region", { name: "Dove si accumula il tempo" });
    const testo = await sezione.innerText();

    expect(testo).toMatch(/\d+%/);
    // Ogni fase dichiara se in essa si lavora o si aspetta.
    expect(testo).toMatch(/si aspetta/);
  });

  test("dichiara che l'attesa in backlog resta fuori dalla misura", async ({ page }) => {
    /*
     * Questione Q1, decisa. Includere il tempo in backlog farebbe risultare
     * «da fare» il collo di bottiglia di quasi ogni progetto — vero e inutile.
     * Una scelta del genere va detta dove si legge il numero, altrimenti chi
     * confronta con il lead time trova una differenza inspiegabile.
     */
    await page.goto(`/progetti/${PROJECT}/flusso`);

    const sezione = page.getByRole("region", { name: "Dove si accumula il tempo" });
    expect(await sezione.innerText()).toMatch(/attesa in backlog.*resta fuori/s);
  });
});
