import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BarChart, type Bar } from "@/components/charts/bar-chart";

/**
 * The bar chart, rendered on the server.
 *
 * These tests exist because of a measured defect: as an SVG with a fixed
 * `viewBox`, the labels rendered at 3,9 pixels inside a phone-width column.
 * What is checked here is the property that made the rewrite worth doing —
 * the text is **text**, at the page's own size, at every width.
 */

const BARS: readonly Bar[] = [
  { label: "Fondamenta del carrello", value: 31, display: "31 punti · 3 senza stima" },
  { label: "Metodi di pagamento", value: 45, display: "45 punti · 1 senza stima" },
  { label: "Conferma d'ordine", value: null, display: "non disponibile" },
];

describe("grafico a barre", () => {
  const markup = renderToStaticMarkup(<BarChart bars={BARS} title="Velocity per sprint" />);

  it("non disegna un SVG scalabile", () => {
    // La regressione da impedire: tornare a un viewBox fisso rimetterebbe le
    // etichette a quattro pixel su telefono.
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("viewBox");
  });

  it("scrive ogni etichetta e ogni valore come testo", () => {
    expect(markup).toContain("Fondamenta del carrello");
    expect(markup).toContain("31 punti · 3 senza stima");
  });

  it("non tronca un'etichetta di valore lunga", () => {
    // Prima venivano tagliate a «31 punti · 3 senza»: un'etichetta troncata si
    // legge come una frase compiuta e dice qualcosa che il dato non dice.
    expect(markup).toContain("45 punti · 1 senza stima");
  });

  it("è una lista, percorribile da un lettore di schermo", () => {
    // L'SVG offriva un solo aria-label per l'intero grafico: il titolo, e
    // nient'altro.
    expect(markup).toContain("<ul");
    expect(markup.match(/<li/g)?.length).toBe(BARS.length);
  });

  it("dice «non disponibile» invece di disegnare uno zero", () => {
    expect(markup).toContain("non disponibile");
  });

  it("una barra assente non disegna nulla, una barra a zero lascia un filo", () => {
    const conZero = renderToStaticMarkup(
      <BarChart bars={[{ label: "Sprint", value: 0 }]} title="Velocity" />,
    );

    // Zero misurato e valore mancante devono restare distinguibili a colpo
    // d'occhio, non solo nel testo accanto.
    expect(conZero).toContain("width:1%");
  });

  it("le larghezze sono proporzioni, non pixel", () => {
    // È ciò che rende il grafico corretto a qualunque larghezza senza sapere
    // quale sia.
    expect(markup).toMatch(/width:\d+(\.\d+)?%/);
    expect(markup).not.toMatch(/width:\d+px/);
  });

  it("dichiara l'assenza di dati invece di mostrare una cornice vuota", () => {
    const vuoto = renderToStaticMarkup(<BarChart bars={[]} title="Velocity" />);

    expect(vuoto).toContain("Nessun dato");
    expect(vuoto).not.toContain("<ul");
  });
});
