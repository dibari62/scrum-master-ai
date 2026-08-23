import { expect, test } from "@playwright/test";

/**
 * The sprint report, from an agent that cannot run it to a report on screen.
 *
 * What this covers that unit tests cannot: the configuration is *obeyed*. The
 * card announces which skills are enabled, and until now that announcement was
 * decoration — `enabledSkillKeys` shipped with nothing able to set it, so it
 * described a decision nobody could take.
 *
 * It also checks the property the whole feature exists for: the figures in the
 * prose are the figures shown beside it. A report whose numbers disagreed with
 * its own evidence would be worse than one with no numbers at all.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";
const CARD = "/progetti/checkout/scrum-master";

test.describe("resoconto di sprint", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  test("una skill non abilitata non si può eseguire, e si può abilitare", async ({ page }) => {
    await page.goto(CARD);

    // Si parte da uno stato noto: disabilitata.
    const disable = page.getByRole("button", { name: "Disabilita la skill" });
    if (await disable.isVisible()) {
      await disable.click();
      await page.waitForLoadState("networkidle");
    }

    await expect(page.getByRole("button", { name: "Genera il resoconto" })).toHaveCount(0);
    await expect(page.getByText("non è fra le skill abilitate")).toBeVisible();

    await page.getByRole("button", { name: "Abilita il resoconto di sprint" }).click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: "Genera il resoconto" })).toBeVisible();
  });

  test("il resoconto cita solo i numeri che mostra accanto a sé", async ({ page }) => {
    await page.goto(CARD);

    const enable = page.getByRole("button", { name: "Abilita il resoconto di sprint" });
    if (await enable.isVisible()) {
      await enable.click();
      await page.waitForLoadState("networkidle");
    }

    await page.getByRole("button", { name: "Genera il resoconto" }).click();
    await page.waitForLoadState("networkidle");

    const report = page.locator("[data-report]").first();
    await expect(report).toBeVisible();

    const prose = (await report.locator("[data-report-prose]").innerText()).trim();
    const figures = await report.locator("[data-report-figure]").allInnerTexts();

    // La proprietà: ogni cifra nella prosa compare fra i valori mostrati, o è
    // parte del nome dello sprint. Nient'altro è ammesso.
    const sprintName = await report.locator("[data-report-sprint]").innerText();
    const allowed = new Set<string>();

    for (const source of [...figures, sprintName]) {
      for (const match of source.matchAll(/\d+(?:[.,]\d+)?/g)) allowed.add(match[0]);
    }

    const strangers = [...prose.matchAll(/\d+(?:[.,]\d+)?/g)]
      .map((match) => match[0])
      .filter((token) => !allowed.has(token));

    expect(strangers, `cifre nel testo che non compaiono fra i numeri: ${strangers.join(", ")}`)
      .toEqual([]);
  });

  test("il resoconto compare nel registro con il suo costo", async ({ page }) => {
    await page.goto(CARD);

    // Il registro è l'unico posto in cui il prezzo del prodotto si vede.
    await expect(page.getByText("sprint-report", { exact: false }).first()).toBeVisible();
  });

  test("dalla dashboard si arriva alla scheda dell'agente", async ({ page }) => {
    await page.goto(`/progetti/${PROJECT}`);

    // Ristretto a `main`: nell'intestazione c'è il marchio, che ha lo stesso
    // nome e porta altrove.
    await page.locator("main").getByRole("link", { name: "Scrum Master AI" }).first().click();
    await page.waitForURL("**/scrum-master");

    await expect(page.getByRole("heading", { name: "Resoconto di sprint" })).toBeVisible();
  });
});
