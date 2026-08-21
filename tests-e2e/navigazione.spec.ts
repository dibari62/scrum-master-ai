import { expect, test } from "@playwright/test";

import { makeFixture, removeFixture, type Fixture } from "./fixtures";

/**
 * Whether the application can actually be walked through.
 *
 * Every other test checks that a page is right once you are on it. None
 * checked that you can *get* there — and that is exactly what broke: the
 * projects were built, deployed and working, while the page every session
 * lands on still announced that projects would arrive later and offered no
 * link to them. Someone signing in would have read that there was nothing to
 * see and stopped, with the whole feature one URL away.
 *
 * A dead end is a defect even when every page in isolation is perfect.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

test.describe("navigazione", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test scrivono su un database reale");

  const created: Fixture[] = [];

  test.afterAll(async () => {
    for (const fixture of created) await removeFixture(fixture);
    created.length = 0;
  });

  test("dall'area azienda si arriva ai progetti senza scrivere l'indirizzo a mano", async ({
    page,
  }) => {
    const fixture = makeFixture("navigazione");
    created.push(fixture);

    await page.goto("/registrati");
    await page.fill("#organizationName", fixture.organizationName);
    await page.fill("#organizationSlug", fixture.organizationSlug);
    await page.fill("#name", fixture.personName);
    await page.fill("#email", fixture.email);
    await page.fill("#password", fixture.password);
    await page.getByRole("button", { name: "Crea l'account" }).click();

    await page.waitForURL("**/organizzazione");

    // Il punto del test: un collegamento cliccabile, non un indirizzo da
    // indovinare.
    await page.getByRole("link", { name: "Vai ai progetti" }).click();
    await page.waitForURL("**/progetti");

    await expect(page.getByRole("heading", { name: "Progetti", level: 1 })).toBeVisible();

    // E si deve poter tornare indietro: un vicolo cieco in uscita è un vicolo
    // cieco comunque.
    await page.getByRole("link", { name: "Torna all'area azienda" }).click();
    await page.waitForURL("**/organizzazione");
  });

  test("un'azienda senza progetti lo dice, invece di mostrare una pagina vuota", async ({
    page,
  }) => {
    const fixture = makeFixture("vuota");
    created.push(fixture);

    await page.goto("/registrati");
    await page.fill("#organizationName", fixture.organizationName);
    await page.fill("#organizationSlug", fixture.organizationSlug);
    await page.fill("#name", fixture.personName);
    await page.fill("#email", fixture.email);
    await page.fill("#password", fixture.password);
    await page.getByRole("button", { name: "Crea l'account" }).click();

    await page.waitForURL("**/organizzazione");
    await page.goto("/progetti");

    // Un'azienda appena creata non ha progetti: la pagina deve spiegarlo.
    // Una lista vuota senza parole si legge come un guasto.
    await expect(page.getByRole("heading", { name: "Progetti", level: 1 })).toBeVisible();
    await expect(page.getByText("Nessun progetto")).toBeVisible();
  });
});
