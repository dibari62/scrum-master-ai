import { describe, expect, it } from "vitest";

import {
  linearScale,
  niceDomain,
  polylinePath,
  ticks,
} from "@/components/charts/scale";
import {
  formatCostUsd,
  formatDuration,
  formatEstimate,
  formatNumber,
  formatPercent,
} from "@/lib/format";

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

  it("accordano l'unità della stima con il numero", () => {
    // Diceva «1 punti». Un dettaglio, ma su una pagina che chiede di essere
    // creduta sui numeri anche la lingua sbagliata toglie credibilità.
    expect(formatEstimate(1, "points")).toBe("1 punto");
    expect(formatEstimate(5, "points")).toBe("5 punti");
    expect(formatEstimate(1, "hours")).toBe("1 ora");
    expect(formatEstimate(4, "hours")).toBe("4 ore");
  });

  it("non assumono mai i punti: l'unità è sempre scritta", () => {
    // Il glossario è esplicito: punti e ore non si sommano fra loro, e un
    // numero senza unità rende quell'errore invisibile.
    expect(formatEstimate(3, "hours")).toContain("ore");
    expect(formatEstimate(3, "points")).toContain("punti");
  });

  it("non appiattiscono a «0 min» una durata inferiore al minuto", () => {
    /*
     * Il registro delle esecuzioni mostrava «0 min» per una chiamata durata
     * cinquanta millisecondi: si legge come «nessun tempo», non come «meno di
     * un minuto». È lo stesso errore di stampare 0 dove una metrica non è
     * disponibile, e su un registro che esiste per misurare è l'unico
     * intervallo che non può collassare.
     */
    expect(formatDuration(50)).toBe("50 ms");
    expect(formatDuration(1500)).toBe("1,5 s");
    expect(formatDuration(45_000)).toBe("45 s");
  });

  it("continuano a scalare l'unità sopra il minuto", () => {
    expect(formatDuration(90_000)).toBe("2 min");
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe("2 ore");
    expect(formatDuration(3 * 24 * 60 * 60 * 1000)).toBe("3 giorni");
  });

  it("dicono «nessun costo» invece di una fila di zeri", () => {
    // Con il fornitore fittizio nulla è stato speso e nulla poteva esserlo:
    // «0,000000» inviterebbe a chiedersi se il numero sia semplicemente
    // mancato.
    expect(formatCostUsd(0)).toBe("nessun costo");
  });

  it("mostrano sei decimali per non arrotondare a zero una chiamata piccola", () => {
    const formatted = formatCostUsd(0.000123);

    expect(formatted).toContain("0,000123");
    expect(formatted).toContain("USD");
  });
});

/**
 * Il grafico a barre non è più un SVG.
 *
 * Il `viewBox` fisso a 720 unità veniva scalato al 39% dentro una colonna da
 * telefono, e le etichette finivano rese a 3,9 pixel — misurati. I test che
 * stavano qui verificavano il calcolo delle fasce laterali di quell'SVG:
 * descrivevano bene un problema che ora non esiste, e mantenerli avrebbe
 * significato tenere in vita del codice solo perché era testato.
 *
 * Le proporzioni ora le esprime il CSS, che è nato per questo. Ciò che resta da
 * verificare è la resa sul server, in `bar-chart.test.tsx`.
 */
describe("dominio del grafico a barre", () => {
  it("parte sempre da zero", () => {
    // Un grafico a barre tagliato sopra lo zero trasforma una differenza del
    // cinque per cento in un raddoppio visivo.
    const [min] = niceDomain([95, 100]);

    expect(min).toBe(0);
  });

  it("lascia spazio sopra il valore più alto", () => {
    const [, max] = niceDomain([100]);

    expect(max).toBeGreaterThan(100);
  });
});

