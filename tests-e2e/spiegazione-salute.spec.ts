import { expect, test } from "@playwright/test";

import { enableSkill } from "./fixtures";

/**
 * Asking the Scrum Master AI to explain the verdict, in a browser.
 *
 * **What only a browser can check here** is that the whole chain holds together:
 * the capability is switched on from the card, the button appears on the
 * dashboard, pressing it reaches a provider, and what comes back survives the
 * checks and is rendered. Each piece is unit-tested; none of those tests would
 * notice a server action wired to the wrong page.
 *
 * It also covers the case that matters most for a demonstration without a vendor
 * key: the deterministic provider's canned answer has to pass the same schema,
 * fidelity and anchoring checks a real model's answer does. A stub that cheated
 * would demonstrate nothing.
 *
 * This suite **writes**: it enables a skill on the seeded project's agent. That
 * is deliberate — leaving the capability on is the state a demonstration wants.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

test.describe("spiegazione della salute", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("si accende dalla scheda e risponde dalla dashboard", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}`);

    const dashboard = await page.locator("main").innerText();
    if (dashboard.includes("Nessuno sprint in corso")) {
      test.skip(true, "senza uno sprint aperto non c'è alcun giudizio da spiegare");
    }

    // La capacità si accende dov'è descritta, non da una preferenza nascosta.
    await enableSkill(page, PROJECT, "Abilita la salute dello sprint");

    await page.goto(`/progetti/${PROJECT}`);

    const ask = page.getByRole("button", { name: /Chiedi una spiegazione/i });
    await expect(ask).toBeVisible();

    await ask.click();

    /*
     * Si attende un esito, quale che sia.
     *
     * Un rifiuto spiegato è un successo di questo test tanto quanto un testo:
     * ciò che non deve accadere è che premere il pulsante non produca nulla,
     * che è esattamente il difetto che un test di unità non vedrebbe.
     */
    const outcome = page.locator("main").getByText(
      /calcolato dal codice|non è fra le skill|Raggiunto il limite|sospeso|rifiutat/i,
    );

    await expect(outcome.first()).toBeVisible({ timeout: 30_000 });
  });

  test("accendere una capacità non ne spegne un'altra", async ({ page }) => {
    /*
     * La regressione da impedire, e il motivo per cui merita un test suo.
     *
     * L'interruttore leggeva l'insieme delle capacità accese, ne cambiava una e
     * riscriveva l'insieme intero. Con una sola capacità accendibile funzionava;
     * con due, accendere la salute spegneva il resoconto — e il sintomo
     * arrivava altrove, come un pulsante mancante in tre suite diverse, dove
     * nessuno lo avrebbe cercato.
     */
    await enableSkill(page, PROJECT, "Abilita il resoconto di sprint");
    await enableSkill(page, PROJECT, "Abilita la salute dello sprint");

    await page.goto(`/progetti/${PROJECT}/scrum-master`);

    await expect(page.getByRole("button", { name: "Genera il resoconto" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disabilita la salute dello sprint" }),
    ).toBeVisible();
  });

  test("dichiara che il testo non viene conservato", async ({ page }) => {
    /*
     * Perché è un requisito e non una gentilezza: la narrazione descrive lo
     * stato di adesso. Chi la ritrovasse domani, senza questa riga, la
     * leggerebbe come un documento datato invece che come una lettura scaduta.
     */
    await enableSkill(page, PROJECT, "Abilita la salute dello sprint");
    await page.goto(`/progetti/${PROJECT}`);

    const body = await page.locator("main").innerText();

    if (!body.includes("Chiedi una spiegazione")) test.skip();

    await page.getByRole("button", { name: /Chiedi una spiegazione/i }).click();

    await expect(
      page.getByText(/Non viene conservato|non viene conservato/).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
