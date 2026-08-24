import { expect, test, type Page } from "@playwright/test";

/**
 * Whether the pages hold together on a narrow screen.
 *
 * **Why this is a test and not a look.** The bar chart was an SVG with a fixed
 * `viewBox` of 720 units. Inside a phone-width column it was scaled to 39%, so
 * its labels rendered at **3,9 pixels** — measured, not estimated. On the
 * machine it was written on the chart looked correct at every size, because
 * that machine never showed it at 375 pixels.
 *
 * Two properties are checked here, and both are the kind that only a browser
 * can answer:
 *
 * - **nothing overflows sideways.** A horizontal scrollbar on a phone hides
 *   content behind an edge nobody thinks to drag.
 * - **no text renders below ten pixels.** Font size is measured *after* any SVG
 *   transform, because inside a scalable drawing the declared size is not the
 *   rendered one — which is exactly what made the original defect invisible to
 *   a stylesheet review.
 */

const ENABLED = process.env["RUN_E2E"] === "1";

const PROJECT = "checkout";

/** A phone, a small tablet, a tablet, and a laptop. */
const WIDTHS = [375, 640, 768, 1280] as const;

const PAGES = [
  "/progetti",
  `/progetti/${PROJECT}`,
  `/progetti/${PROJECT}/elementi`,
  `/progetti/${PROJECT}/sprint`,
  `/progetti/${PROJECT}/persone`,
  "/metriche",
] as const;

/** Below this a label stops being small text and becomes a smudge. */
const MIN_READABLE_PX = 10;

async function measure(page: Page) {
  return page.evaluate((floor) => {
    const doc = document.documentElement;
    const tiny: string[] = [];

    for (const el of document.querySelectorAll("main *")) {
      if (el.childElementCount > 0) continue;

      const text = el.textContent?.trim();
      if (!text) continue;
      if (el.getBoundingClientRect().height === 0) continue;

      const declared = parseFloat(getComputedStyle(el).fontSize);
      const svg = (el as SVGElement).ownerSVGElement;

      // Inside an SVG the whole coordinate system is scaled to fit, text
      // included: the declared size tells you nothing about what a reader sees.
      const rendered = svg
        ? declared * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width)
        : declared;

      if (rendered < floor) tiny.push(`${text.slice(0, 20)} @ ${rendered.toFixed(1)}px`);
    }

    return {
      overflows: doc.scrollWidth > doc.clientWidth,
      overflowBy: doc.scrollWidth - doc.clientWidth,
      tiny,
    };
  }, MIN_READABLE_PX);
}

test.describe("adattamento agli schermi", () => {
  test.skip(!ENABLED, "impostare RUN_E2E=1: questi test leggono un database reale");

  test.beforeEach(async ({ page }) => {
    await page.goto("/accedi");
    await page.fill("#email", "ispettore-temporaneo@example.invalid");
    await page.fill("#password", "cavallo-batteria-graffetta");
    await page.locator("#password").press("Enter");
    await page.waitForURL("**/organizzazione");
  });

  for (const width of WIDTHS) {
    for (const path of PAGES) {
      test(`${path} a ${width}px non sborda e resta leggibile`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.waitForLoadState("networkidle");

        const result = await measure(page);

        expect(
          result.overflows,
          `sborda di ${result.overflowBy}px: contenuto nascosto oltre il bordo`,
        ).toBe(false);

        expect(
          result.tiny,
          `testo reso sotto ${MIN_READABLE_PX}px: ${result.tiny.join("; ")}`,
        ).toEqual([]);
      });
    }
  }

  test("il grafico a barre resta testo a qualunque larghezza", async ({ page }) => {
    // La regressione da impedire: tornare a un SVG con viewBox fisso
    // rimetterebbe le etichette a quattro pixel su telefono.
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/progetti/${PROJECT}`);
    await page.waitForLoadState("networkidle");

    const velocity = page.locator("figure", { hasText: "Velocity per sprint" });

    await expect(velocity).toContainText("punti");
    await expect(velocity.locator("svg")).toHaveCount(0);
  });

  test("si esce e si torna all'azienda da qualunque pagina", async ({ page }) => {
    // L'intestazione esiste perché uscire era possibile da una sola schermata,
    // e da una pagina di progetto non c'era modo di tornare all'area azienda.
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/progetti/${PROJECT}/elementi`);

    await expect(page.getByRole("button", { name: "Esci" })).toBeVisible();

    await page.getByRole("link", { name: "Azienda" }).click();
    await page.waitForURL("**/organizzazione");
  });

  test("i filtri sono abbastanza grandi da toccarli", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/progetti/${PROJECT}/elementi`);
    await page.waitForLoadState("networkidle");

    // Le linee guida di Apple e Google indicano quarantaquattro punti come
    // minimo; trentasei è il compromesso che questi filtri possono reggere
    // restando affiancabili. Diciotto, com'erano, non è un bersaglio.
    const primo = page.getByRole("link", { name: "Conclusi" });
    const box = await primo.boundingBox();

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
  });

  /**
   * Whether a control that is *visible* is also *clickable*.
   *
   * The sticky header caused a defect that looked like nothing at all: the
   * "Verifica configurazione" button rendered correctly, was enabled, and read
   * as available to a screen reader — but whenever the browser scrolled it into
   * view on its own (the Tab key, an in-page link, a field carrying an error)
   * it landed underneath the header, and the click went to the header. Measured
   * before the fix: unreachable in four window sizes out of five.
   *
   * No snapshot and no stylesheet review can see this. The question "who
   * actually receives a click at these coordinates" is one only a laid-out page
   * can answer, which is why it is asserted here rather than in a unit test.
   */
  const CONTROL_PAGES = [
    `/progetti/${PROJECT}`,
    `/progetti/${PROJECT}/elementi`,
    `/progetti/${PROJECT}/sprint`,
    `/progetti/${PROJECT}/persone`,
    `/progetti/${PROJECT}/scrum-master`,
    "/metriche",
  ] as const;

  for (const height of [400, 900] as const) {
    for (const path of CONTROL_PAGES) {
      test(`i comandi di ${path} ricevono i clic con finestra alta ${height}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height });
        await page.goto(path);
        await page.waitForLoadState("networkidle");

        const stolen = await page.evaluate(() => {
          const blocked: string[] = [];

          for (const control of document.querySelectorAll<HTMLElement>(
            "main button, main a[href]",
          )) {
            if (control.getBoundingClientRect().height === 0) continue;

            // Esattamente ciò che fa il browser da solo con il tasto Tab.
            control.scrollIntoView();

            const box = control.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );

            if (hit !== control && !control.contains(hit)) {
              const thief = hit?.closest("header") ? "l'intestazione fissa" : (hit?.tagName ?? "?");
              blocked.push(`${control.textContent?.trim().slice(0, 24)} ← ${thief}`);
            }
          }

          return blocked;
        });

        expect(stolen, `comandi visibili che non ricevono il proprio clic: ${stolen.join("; ")}`)
          .toEqual([]);
      });
    }
  }
});
