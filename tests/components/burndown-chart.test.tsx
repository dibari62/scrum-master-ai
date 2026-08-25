import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BurndownChart } from "@/components/charts/burndown-chart";

const POINTS = [
  { at: new Date("2026-05-18T00:00:00Z"), remaining: 36 },
  { at: new Date("2026-05-19T00:00:00Z"), remaining: 33 },
  { at: new Date("2026-05-20T00:00:00Z"), remaining: 28 },
];

/**
 * Rendered on the server, which is the whole point of the chart.
 *
 * This suite exists because of a defect the browser reported and no test did:
 * `<title>{a}: {b} {c}</title>` gives React 19 five adjacent text children,
 * and React — which treats `<title>` as document metadata — emitted
 * `<title></title>`. The labels only appeared once JavaScript had hydrated the
 * page, and every load logged a hydration mismatch.
 */
describe("burndown reso sul server", () => {
  const markup = renderToStaticMarkup(
    <BurndownChart
      points={POINTS}
      committed={36}
      totalDays={3}
      unitLabel="punti"
      title="Burndown"
    />,
  );

  it("scrive le etichette nell'HTML, non solo dopo l'idratazione", () => {
    expect(markup).toContain("<title>18 mag: 36 punti</title>");
  });

  it("non lascia nessun titolo vuoto", () => {
    expect(markup).not.toContain("<title></title>");
  });

  it("descrive l'andamento a chi non vede il grafico", () => {
    expect(markup).toContain("Lavoro residuo da 36 a 28 punti.");
  });

  it("dichiara l'assenza di dati invece di disegnare un grafico vuoto", () => {
    const empty = renderToStaticMarkup(
      <BurndownChart
        points={[]}
        committed={0}
        totalDays={0}
        unitLabel="punti"
        title="Burndown"
      />,
    );

    expect(empty).toContain("Nessun dato");
    expect(empty).not.toContain("<svg");
  });

  it("la linea ideale arriva alla fine dello sprint, non all'ultimo punto noto", () => {
    /*
     * Su uno sprint in corso i punti disegnati sono meno dei giorni totali.
     * Scalando la tratteggiata sui punti disponibili arriverebbe a zero
     * *oggi*, e ogni sprint sembrerebbe in ritardo disperato fino all'ultimo
     * giorno.
     *
     * Si verifica sull'ascissa finale della tratteggiata: con dieci giorni
     * totali e tre punti, deve toccare il bordo destro dell'area di disegno.
     */
    const running = renderToStaticMarkup(
      <BurndownChart
        points={POINTS}
        committed={36}
        totalDays={10}
        unitLabel="punti"
        title="Burndown"
      />,
    );

    // 720 di larghezza meno 16 di margine destro: il bordo del grafico.
    expect(running).toContain("704");
  });

  it("spiega che i giorni non lavorativi non ci sono", () => {
    expect(markup).toContain("giorno lavorativo");
  });
});
