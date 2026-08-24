import { expect, test } from "@playwright/test";

/**
 * The Scrum Master AI card, judged on whether it can be understood.
 *
 * **Why this suite exists.** The Product Owner opened the page and could not
 * tell what it was for. Nothing was broken: every value shown was correct, the
 * data was right, no test failed. It was written for whoever had built it.
 *
 * It was then rewritten once and *still* read as dense and chaotic, because the
 * problem was not the wording — it was that one page answered four unrelated
 * questions at once. It is now four screens behind a menu, and these tests
 * assert that the structure holds: each screen answers one question, and what
 * belongs to another does not appear on it.
 *
 * That class of defect passes every check a program can make about itself,
 * which is why it has to be asserted deliberately.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const BASE = "/progetti/checkout/scrum-master";

const MENU = "Sezioni dello Scrum Master AI";

test.describe("scheda dello Scrum Master AI: si capisce", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");

    await page.goto(BASE);
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("il menù offre le quattro schermate, e dice quale è aperta", async ({ page }) => {
    const menu = page.getByRole("navigation", { name: MENU });

    for (const voce of ["Cosa può fare", "Resoconti", "Configurazione", "Diario tecnico"]) {
      await expect(menu.getByRole("link", { name: new RegExp(voce) })).toBeVisible();
    }

    /*
     * `aria-current` e non solo il colore.
     *
     * Chi ascolta la pagina non riceve un bordo colorato: senza questo
     * attributo il menù direbbe quali schermate esistono, non quale si sta
     * guardando.
     */
    await expect(menu.getByRole("link", { name: "Cosa può fare" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("dice che cos'è, su qualunque schermata si arrivi", async ({ page }) => {
    /*
     * La frase sta nel contenitore comune perché la domanda «che cos'è» resta
     * la stessa ovunque. Chi apre un collegamento diretto ai resoconti ha lo
     * stesso bisogno di chi entra dalla prima schermata.
     */
    for (const path of ["", "/resoconti", "/configurazione", "/diario"]) {
      await page.goto(`${BASE}${path}`);

      const body = await page.locator("main").innerText();
      expect(body, `manca la frase che dice che cos'è su ${path || "/"}`).toContain(
        "È lo Scrum Master AI di questo progetto",
      );
    }
  });

  test("la prima schermata è quella che produce qualcosa", async ({ page }) => {
    // Non la configurazione: è la risposta a una domanda che il lettore non ha
    // ancora avuto modo di porsi.
    const body = await page.locator("main").innerText();

    expect(body).toContain("Resoconto di sprint");
    expect(body, "la configurazione è finita sulla prima schermata").not.toContain(
      "Cosa non farà mai",
    );
  });

  test("ogni schermata risponde a una domanda sola", async ({ page }) => {
    /*
     * Il difetto che ha fatto nascere il menù: una pagina che diceva insieme
     * cosa può fare, cosa ha prodotto, com'è configurata e cosa ha eseguito.
     * Qui si verifica che le quattro cose non tornino a mescolarsi.
     */
    const casi = [
      { path: "/resoconti", assente: "Al massimo" },
      { path: "/configurazione", assente: "Genera il resoconto" },
      { path: "/diario", assente: "Non ancora costruite" },
    ] as const;

    for (const caso of casi) {
      await page.goto(`${BASE}${caso.path}`);
      const body = await page.locator("main").innerText();

      expect(body, `${caso.path} contiene ancora «${caso.assente}»`).not.toContain(
        caso.assente,
      );
    }
  });

  test("non mostra identificativi di macchina al posto dei nomi", async ({ page }) => {
    /*
     * `sprint-report` è l'identificativo stabile e non va rinominato: è
     * persistito su ogni abilitazione e ogni esecuzione. È anche privo di
     * significato per chi legge, ed è per questo che era la cosa sbagliata da
     * stampare sulla scheda.
     *
     * Resta legittimo nel diario tecnico, che è dichiaratamente tecnico.
     */
    const capacita = await page.locator("main").innerText();
    expect(capacita).toContain("Resoconto di sprint");
    expect(capacita, "un identificativo di macchina è fra le capacità").not.toContain(
      "sprint-report",
    );

    await page.goto(`${BASE}/configurazione`);
    expect(await page.locator("main").innerText()).not.toContain("sprint-report");
  });

  test("ogni valore della configurazione ha un'etichetta e una spiegazione", async ({
    page,
  }) => {
    // Prima diceva «Facilitatore · Osserva · Attivo · lingua it»: quattro
    // valori di fila, senza nome, di cui almeno due incomprensibili a chi non
    // aveva compilato il modulo di creazione.
    await page.goto(`${BASE}/configurazione`);
    const body = await page.locator("main").innerText();

    for (const label of [
      "Stato:",
      "Quanto può spingersi:",
      "Come si pone:",
      "Lingua in cui scrive:",
    ]) {
      expect(body, `manca l'etichetta «${label}»`).toContain(label);
    }

    expect(body).toContain("raccoglie e mostra, non scrive nulla");
    // «Budget di token» rimandava a un concetto che la pagina non introduceva.
    expect(body).toMatch(/frammenti di parola/);
  });

  test("i nomi delle capacità sono intestazioni raggiungibili", async ({ page }) => {
    // Un `div` che sembra un titolo è invisibile a chi naviga saltando di
    // intestazione in intestazione, ed è proprio il nome della capacità che
    // deve poter trovare.
    await expect(page.getByRole("heading", { name: "Resoconto di sprint" })).toBeVisible();
  });

  test("dichiara ciò che non sa ancora fare, invece di tacerlo", async ({ page }) => {
    // Nasconderle lascerebbe credere che il prodotto finisca qui; mostrarle
    // come pulsanti spenti lascerebbe credere che siano rotte.
    const body = await page.locator("main").innerText();

    expect(body).toContain("Non ancora costruite");
    expect(body).toContain("Digest giornaliero");
  });

  test("il diario tecnico dice a cosa serve e non occupa la scheda", async ({ page }) => {
    await page.goto(`${BASE}/diario`);
    const body = await page.locator("main").innerText();

    expect(body).toMatch(/ha funzionato/);
    expect(body).toMatch(/quanto è costato/);

    // Ciò che non si vede va detto, non fatto sparire. Contate per attributo e
    // non per selettore: `main ul > li` prende anche le briciole di pane e le
    // voci del menù, cioè misura qualcosa che non è il registro.
    const righe = await page.locator("[data-run]").count();
    expect(righe).toBeLessThanOrEqual(10);
  });

  test("dice quali sprint conclusi non hanno ancora un resoconto", async ({ page }) => {
    // Un elenco che tace le proprie assenze costringe chi legge a chiedersi se
    // il difetto sia nei dati o nella pagina.
    const chiusi = await page.getByLabel("Sprint concluso").locator("option").count();

    await page.goto(`${BASE}/resoconti`);
    const conResoconto = await page.locator("[data-report]").count();

    if (conResoconto < chiusi) {
      expect(await page.locator("main").innerText()).toMatch(
        /non (ha|hanno) ancora un resoconto/,
      );
    }
  });

  test("si può generare il resoconto di uno sprint che non sia l'ultimo", async ({
    page,
  }) => {
    /*
     * Il comando era legato all'ultimo sprint concluso e basta. Con tre sprint
     * chiusi, due non avevano un resoconto e non c'era **alcun modo** di
     * produrlo: la schermata dei resoconti ne mostrava uno solo e sembrava un
     * difetto dei dati, mentre era un limite dell'interfaccia.
     */
    const scelta = page.getByLabel("Sprint concluso");
    await expect(scelta).toBeVisible();

    const opzioni = await scelta.locator("option").allInnerTexts();
    if (opzioni.length < 2) test.skip();

    const piuVecchio = opzioni[opzioni.length - 1] as string;

    await scelta.selectOption({ label: piuVecchio });
    await page.getByRole("button", { name: "Genera il resoconto" }).click();
    await page.waitForURL("**/scrum-master/resoconti");

    await expect(page.getByRole("heading", { name: piuVecchio, level: 2 })).toBeVisible();
  });
});
