import { expect, test } from "@playwright/test";

/**
 * The Scrum Master AI card, judged on whether it can be understood.
 *
 * **Why this suite exists.** The Product Owner opened the page and could not
 * tell what it was for. Nothing was broken: every value shown was correct, the
 * data was right, no test failed. It was simply written for whoever had built
 * it — configuration first, the one useful action buried in the middle, and
 * machine identifiers like `sprint-report` printed at a human.
 *
 * That class of defect passes every check a program can make about itself,
 * which is why it has to be asserted deliberately. These tests do not verify
 * that the page *works*; they verify that it **answers the three questions a
 * reader arrives with**: what is this, what can it do, what has it done.
 *
 * Read-only: it uses the seeded project and creates nothing.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("scheda dello Scrum Master AI: si capisce", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");

    await page.goto(`/progetti/${PROJECT}/scrum-master`);
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("dice che cos'è prima di dire com'è configurato", async ({ page }) => {
    /*
     * La pagina si apriva con «Configurazione», che è la risposta a una domanda
     * che il lettore non ha ancora avuto modo di porsi.
     */
    const body = await page.locator("main").innerText();

    const cosE = body.indexOf("È lo Scrum Master AI di questo progetto");
    const comEConfigurato = body.indexOf("Com'è configurato");

    expect(cosE, "manca la frase che dice che cos'è").toBeGreaterThanOrEqual(0);
    expect(comEConfigurato).toBeGreaterThan(cosE);
  });

  test("mette ciò che si può fare prima della parte tecnica", async ({ page }) => {
    const body = await page.locator("main").innerText();

    const cosaPuoFare = body.indexOf("Cosa può fare");
    const diarioTecnico = body.indexOf("Diario tecnico");

    expect(cosaPuoFare).toBeGreaterThanOrEqual(0);
    expect(diarioTecnico).toBeGreaterThan(cosaPuoFare);
  });

  test("non mostra identificativi di macchina al posto dei nomi", async ({ page }) => {
    /*
     * `sprint-report` è l'identificativo stabile e non va rinominato: è
     * persistito su ogni abilitazione e ogni esecuzione. È anche privo di
     * significato per chi legge, ed è per questo che era la cosa sbagliata da
     * stampare sulla scheda.
     *
     * Resta legittimo nel diario tecnico, che è dichiaratamente tecnico. Qui si
     * verifica che non compaia dove dovrebbe esserci un nome.
     */
    const capacita = page
      .locator("section")
      .filter({ hasText: "Cosa può fare" })
      .first();

    const text = await capacita.innerText();

    expect(text).toContain("Resoconto di sprint");
    expect(text, "un identificativo di macchina è finito fra le capacità").not.toContain(
      "sprint-report",
    );
  });

  test("ogni valore dello stato ha un'etichetta e una spiegazione", async ({ page }) => {
    /*
     * Prima diceva «Facilitatore · Osserva · Attivo · lingua it»: quattro
     * valori di fila, senza nome, di cui almeno due incomprensibili a chi non
     * aveva compilato il modulo di creazione.
     */
    const body = await page.locator("main").innerText();

    for (const label of [
      "Stato",
      "Quanto può spingersi",
      "Come si pone",
      "Lingua in cui scrive",
    ]) {
      expect(body, `manca l'etichetta «${label}»`).toContain(label);
    }

    // E almeno una spiegazione vera, non solo il valore nudo.
    expect(body).toContain("raccoglie e mostra, non scrive nulla");
  });

  test("i nomi delle capacità sono intestazioni raggiungibili", async ({ page }) => {
    // Un `div` che sembra un titolo è invisibile a chi naviga saltando di
    // intestazione in intestazione, ed è proprio il nome della capacità che
    // deve poter trovare.
    await expect(
      page.getByRole("heading", { name: "Resoconto di sprint" }),
    ).toBeVisible();
  });

  test("dichiara ciò che non sa ancora fare, invece di tacerlo", async ({ page }) => {
    // Nasconderle lascerebbe credere che il prodotto finisca qui; mostrarle
    // come pulsanti spenti lascerebbe credere che siano rotte.
    const body = await page.locator("main").innerText();

    expect(body).toContain("Non ancora costruite");
    expect(body).toContain("Digest giornaliero");
  });

  test("il diario tecnico dice a cosa serve e non occupa la pagina", async ({ page }) => {
    const body = await page.locator("main").innerText();

    expect(body).toMatch(/ha funzionato/);
    expect(body).toMatch(/quanto è costato/);

    /*
     * Il registro era arrivato a diciotto righe quasi identiche e occupava più
     * spazio di tutto ciò per cui si arriva sulla pagina. Se ne mostrano poche
     * e si dice quante ne restano: ciò che non si vede va detto, non fatto
     * sparire.
     */
    const diario = page.locator("section").filter({ hasText: "Diario tecnico" }).first();
    const righe = await diario.locator("ul > li").count();

    expect(righe).toBeLessThanOrEqual(5);
  });

  test("spiega il token invece di darlo per noto", async ({ page }) => {
    // «Budget di token: quello dichiarato dalla skill» rimandava a un concetto
    // che la pagina non aveva mai introdotto.
    const body = await page.locator("main").innerText();

    expect(body).toMatch(/frammenti di parola/);
  });
});
