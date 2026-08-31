import { describe, expect, it } from "vitest";

import { dataFreshness, describeAge } from "@/lib/projects/freshness";

/**
 * Quanto sono vecchi i dati, e quando vale la pena dirlo.
 *
 * **Il problema che questa funzione affronta.** La lettura da Jira parte solo
 * premendo un pulsante: finché non esiste un job schedulato, una dashboard
 * mostra la fotografia dell'ultima volta che qualcuno se n'è ricordato. Le
 * metriche restano corrette — descrivono fedelmente i dati che ci sono — ma i
 * dati possono essere di ieri, e chi guarda non ha modo di indovinarlo.
 */

const NOW = new Date("2026-08-31T17:00:00.000Z");

function freshness(connector: "jira" | "seed" | null, lastSyncedAt: Date | null) {
  return dataFreshness({ connector, lastSyncedAt, now: NOW });
}

describe("da quanto tempo i dati non vengono riletti", () => {
  it("tace per una fonte che non si legge dal portale", () => {
    /*
     * I dati di esempio si caricano da riga di comando: «mai letti» sarebbe
     * falso su un progetto dimostrativo pieno di dati, e su un progetto senza
     * connettore sarebbe rumore su una schermata che ha già i primi passi.
     */
    expect(freshness("seed", null).kind).toBe("not-applicable");
    expect(freshness(null, null).kind).toBe("not-applicable");
  });

  it("distingue «mai letto» da «letto tanto tempo fa»", () => {
    // Il primo è un progetto che non è ancora cominciato, il secondo è un
    // progetto trascurato: due frasi diverse, e solo una è un avviso.
    expect(freshness("jira", null).kind).toBe("never");
    expect(freshness("jira", new Date("2026-08-01T09:00:00.000Z")).kind).toBe("stale");
  });

  it("non avverte per una lettura di poche ore fa", () => {
    const outcome = freshness("jira", new Date("2026-08-31T14:00:00.000Z"));

    expect(outcome.kind).toBe("fresh");
    if (outcome.kind !== "fresh") throw new Error("attesa lettura recente");
    expect(outcome.hours).toBe(3);
  });

  it("avverte esattamente al superamento delle ventiquattro ore", () => {
    /*
     * La soglia è il ritmo dello Scrum: la riunione di ogni giorno guarda com'è
     * andata quella prima, quindi dati fermi da più di un giorno arrivano
     * proprio nel momento in cui ingannano di più.
     */
    const appena = freshness("jira", new Date("2026-08-30T17:00:01.000Z"));
    const oltre = freshness("jira", new Date("2026-08-30T17:00:00.000Z"));

    expect(appena.kind).toBe("fresh");
    expect(oltre.kind).toBe("stale");
  });

  it("tratta un segnatempo nel futuro come «appena letto», invece che come un errore", () => {
    /*
     * Succede con due orologi sfasati di qualche minuto, ed è un caso reale.
     * «Letto fra due ore» è il modo più veloce per far perdere fiducia a
     * un'intera schermata.
     */
    const outcome = freshness("jira", new Date("2026-08-31T19:00:00.000Z"));

    expect(outcome.kind).toBe("fresh");
    if (outcome.kind !== "fresh") throw new Error("attesa lettura recente");
    expect(outcome.hours).toBe(0);
  });
});

describe("come si dice da quanto tempo", () => {
  it("evita di far fare i conti a chi legge", () => {
    // «36 ore» costringe a dividere per ventiquattro; «ieri» no.
    expect(describeAge(0)).toBe("meno di un'ora fa");
    expect(describeAge(1)).toBe("un'ora fa");
    expect(describeAge(5)).toBe("5 ore fa");
    expect(describeAge(30)).toBe("ieri");
    expect(describeAge(72)).toBe("3 giorni fa");
  });

  it("smette di contare i giorni quando la cifra esatta non cambia più nulla", () => {
    expect(describeAge(24 * 9)).toBe("più di una settimana fa");
    expect(describeAge(24 * 40)).toBe("più di due settimane fa");
  });
});
