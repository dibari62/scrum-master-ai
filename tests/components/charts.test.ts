import { describe, expect, it } from "vitest";

import {
  approximateTextWidth,
  barChartGutters,
  linearScale,
  niceDomain,
  polylinePath,
  ticks,
} from "@/components/charts/scale";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";

/**
 * La matematica dei grafici è testata perché una scala sbagliata produce un
 * grafico plausibile e falso — esattamente il tipo di errore che questo
 * progetto esiste per evitare.
 */

describe("linearScale", () => {
  it("mappa gli estremi del dominio sugli estremi dell'intervallo", () => {
    const scale = linearScale([0, 100], [0, 200]);

    expect(scale.to(0)).toBe(0);
    expect(scale.to(100)).toBe(200);
    expect(scale.to(50)).toBe(100);
  });

  it("gestisce un intervallo invertito, come serve per l'asse verticale SVG", () => {
    // In SVG l'origine è in alto: i grafici crescono verso l'alto, quindi
    // l'intervallo va rovesciato.
    const scale = linearScale([0, 10], [100, 0]);

    expect(scale.to(0)).toBe(100);
    expect(scale.to(10)).toBe(0);
  });

  it("non divide per zero quando tutti i valori sono uguali", () => {
    // Una linea piatta a metà altezza è onesta; coordinate NaN produrrebbero
    // un grafico vuoto senza dire perché.
    const scale = linearScale([5, 5], [0, 100]);

    expect(scale.to(5)).toBe(50);
    expect(Number.isFinite(scale.to(5))).toBe(true);
  });
});

describe("niceDomain", () => {
  it("parte sempre da zero", () => {
    // Un grafico a barre tagliato sopra lo zero trasforma una differenza del
    // cinque per cento in un raddoppio visivo.
    expect(niceDomain([95, 100])[0]).toBe(0);
  });

  it("lascia spazio sopra il valore massimo", () => {
    const [, max] = niceDomain([100]);
    expect(max).toBeGreaterThan(100);
  });

  it("resta valido su un insieme vuoto o tutto a zero", () => {
    expect(niceDomain([])).toEqual([0, 1]);
    expect(niceDomain([0, 0])).toEqual([0, 1]);
  });
});

describe("ticks", () => {
  it("include entrambi gli estremi", () => {
    const values = ticks([0, 100], 5);

    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(100);
    expect(values).toHaveLength(5);
  });
});

describe("polylinePath", () => {
  it("produce una stringa vuota senza punti", () => {
    expect(polylinePath([])).toBe("");
  });

  it("usa segmenti dritti, senza smussature", () => {
    // Una curva implicherebbe misurazioni fra un giorno e l'altro che nessuno
    // ha mai preso.
    const path = polylinePath([
      [0, 10],
      [5, 20],
    ]);

    expect(path).toBe("M 0.00 10.00 L 5.00 20.00");
    expect(path).not.toContain("C");
  });
});

describe("formatDuration", () => {
  it.each([
    [30 * 60 * 1000, "30 min"],
    [4 * 60 * 60 * 1000, "4 ore"],
    [60 * 60 * 1000, "1 ora"],
    [3 * 24 * 60 * 60 * 1000, "3 giorni"],
    [24 * 60 * 60 * 1000, "1 giorno"],
  ])("formatta %i come %s", (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });

  it("sceglie l'unità più leggibile invece di una fissa", () => {
    // "0,17 giorni" e "72 ore" sono entrambi corretti e illeggibili.
    expect(formatDuration(4 * 60 * 60 * 1000)).toContain("ore");
    expect(formatDuration(72 * 60 * 60 * 1000)).toContain("giorni");
  });

  it("non produce numeri per un valore non valido", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("formatNumber e formatPercent", () => {
  it("usano la virgola come separatore decimale", () => {
    expect(formatNumber(1.5, 1)).toBe("1,5");
  });

  it("non mostrano zeri finali inutili", () => {
    expect(formatNumber(3, 1)).toBe("3");
  });

  it("non producono NaN", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it("formattano una quota come percentuale", () => {
    expect(formatPercent(0.25)).toBe("25%");
  });
});

/**
 * Le fasce laterali del grafico a barre erano fisse, e tagliavano
 * "31 punti · 3 senza stima" in "31 punti · 3 senza": un'etichetta troncata si
 * legge come una frase compiuta e dice qualcosa che il dato non dice.
 */
describe("fasce del grafico a barre", () => {
  const GUTTER = {
    totalWidth: 720,
    labelFontSize: 12,
    valueFontSize: 11,
  };

  it("lascia spazio all'etichetta di valore più lunga", () => {
    const longest = "31 punti · 3 senza stima";
    const { valueWidth } = barChartGutters({
      ...GUTTER,
      labels: ["Sprint 1"],
      values: [longest, "15 punti"],
    });

    expect(valueWidth).toBeGreaterThanOrEqual(approximateTextWidth(longest, 11));
  });

  it("non lascia che le fasce mangino tutta l'area del grafico", () => {
    const { labelWidth, valueWidth } = barChartGutters({
      ...GUTTER,
      labels: ["Un nome di sprint assurdamente lungo che nessuno scriverebbe mai"],
      values: ["e un valore altrettanto improbabile da mostrare qui accanto"],
    });

    expect(GUTTER.totalWidth - labelWidth - valueWidth).toBeGreaterThanOrEqual(160);
  });

  it("quando lo spazio manca riduce entrambe, non solo una", () => {
    const { labelWidth, valueWidth } = barChartGutters({
      ...GUTTER,
      labels: ["Un nome di sprint assurdamente lungo che nessuno scriverebbe mai"],
      values: ["e un valore altrettanto improbabile da mostrare qui accanto"],
    });

    expect(labelWidth).toBeGreaterThan(0);
    expect(valueWidth).toBeGreaterThan(0);
  });

  it("regge un grafico senza testo da misurare", () => {
    const { labelWidth, valueWidth } = barChartGutters({
      ...GUTTER,
      labels: [],
      values: [],
    });

    expect(labelWidth).toBeGreaterThanOrEqual(0);
    expect(valueWidth).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(labelWidth)).toBe(true);
  });
});
