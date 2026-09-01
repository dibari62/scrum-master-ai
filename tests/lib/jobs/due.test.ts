import { describe, expect, it } from "vitest";

import { describeSchedule, isDue, readsPerMonth, scheduleStalled } from "@/lib/jobs/due";

/**
 * Quando tocca rileggere.
 *
 * **Perché questa decisione sta nel codice e non nello schedulatore.** Il timer
 * esterno chiama a intervalli fissi e non sa nulla dei progetti: è questa
 * funzione a stabilire quali siano scaduti. L'alternativa — un'iscrizione per
 * ogni progetto — metterebbe il ritmo in due posti, e il giorno in cui qualcuno
 * lo cambia dall'interfaccia il servizio esterno resterebbe indietro in
 * silenzio.
 *
 * Ogni «sì» di questa funzione costa una chiamata sulla quota Jira del cliente,
 * quindi i casi che contano di più sono quelli in cui deve rispondere **no**.
 */

const NOW = new Date("2026-08-31T18:00:00.000Z");

function due(schedule: Parameters<typeof isDue>[0]["schedule"], lastSyncedAt: Date | null) {
  return isDue({ schedule, lastSyncedAt, now: NOW });
}

describe("quando tocca rileggere", () => {
  it("non legge mai per un progetto che non l'ha chiesto", () => {
    /*
     * `manual` è il predefinito, e questa è la riga che lo rende innocuo: un
     * progetto che non ha chiesto l'automatismo non deve trovarsi un timer
     * acceso, perché la quota di chiamate è del cliente.
     */
    expect(due("manual", null)).toBe(false);
    expect(due("manual", new Date("2020-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("legge subito un progetto mai letto, qualunque sia il ritmo", () => {
    /*
     * È il caso di chi accende l'automatismo su un progetto appena collegato.
     * Aspettare l'intervallo significherebbe mostrargli un portale vuoto per
     * ventiquattr'ore dopo che ha finito di configurare tutto.
     */
    expect(due("daily", null)).toBe(true);
    expect(due("hourly", null)).toBe(true);
  });

  it("rispetta l'intervallo di ciascun ritmo", () => {
    const unOraFa = new Date("2026-08-31T17:00:00.000Z");
    const treOreFa = new Date("2026-08-31T15:00:00.000Z");

    expect(due("hourly", unOraFa)).toBe(true);
    expect(due("every-4-hours", treOreFa)).toBe(false);
    expect(due("daily", treOreFa)).toBe(false);
  });

  it("concede un minuto di tolleranza, per non slittare a ogni giro", () => {
    /*
     * Lo schedulatore non chiama mai a intervalli perfetti. Se scatta 59 minuti
     * e 40 secondi dopo l'ultima lettura oraria, un confronto rigido salterebbe
     * il giro — e il ritmo reale diventerebbe di due ore, senza che nessuno
     * abbia chiesto niente.
     */
    const quasiUnOraFa = new Date("2026-08-31T17:00:20.000Z");

    expect(due("hourly", quasiUnOraFa)).toBe(true);
  });

  it("non legge quando l'ultima lettura risulta nel futuro", () => {
    /*
     * Con due orologi sfasati il tempo trascorso diventa negativo. Trattarlo
     * come «tanto tempo fa» farebbe rileggere a ogni giro, cioè spendere la
     * quota del cliente per un difetto di sincronizzazione fra macchine.
     */
    expect(due("hourly", new Date("2026-08-31T20:00:00.000Z"))).toBe(false);
  });
});

describe("quando un ritmo dichiarato non viene rispettato", () => {
  /*
   * **Il guasto silenzioso che questi test rendono visibile.** Scegliere «ogni
   * ora» nelle impostazioni non accende nulla da solo: serve uno schedulatore
   * esterno che bussi al portale, perché un'applicazione web non è un processo
   * sempre in esecuzione e non ha nessuno «dentro» che guardi l'orologio.
   *
   * Finché quello schedulatore non c'è, la scelta resta una dichiarazione di
   * intenti — e chi l'ha fatta vedrebbe dati fermi senza spiegazione, avendo
   * fatto tutto giusto dalla sua parte.
   */

  function stalled(schedule: Parameters<typeof isDue>[0]["schedule"], lastSyncedAt: Date | null) {
    return scheduleStalled({ schedule, lastSyncedAt, now: NOW });
  }

  it("non si lamenta di un progetto che non ha chiesto l'automatismo", () => {
    expect(stalled("manual", new Date("2020-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("non si lamenta di un progetto mai letto", () => {
    // Non ha ancora un ritmo da rispettare, e la schermata ha già i primi passi
    // per dirgli cosa fare: un avviso qui arriverebbe prima del primo tentativo.
    expect(stalled("hourly", null)).toBe(false);
  });

  it("tollera qualche intervallo mancato, che è normale", () => {
    /*
     * Uno schedulatore chiama a orari suoi, una lettura può fallire, un progetto
     * può essere stato appena riconfigurato. Dire «non funziona» alla prima
     * occasione produrrebbe un avviso che compare e sparisce — cioè un avviso
     * che si impara a ignorare.
     */
    expect(stalled("hourly", new Date("2026-08-31T16:00:00.000Z"))).toBe(false);
  });

  it("lo dichiara dopo tre intervalli di fila senza che nulla accada", () => {
    // A quel punto non è più un ritardo: è un timer che non c'è.
    expect(stalled("hourly", new Date("2026-08-31T14:00:00.000Z"))).toBe(true);
    expect(stalled("daily", new Date("2026-08-27T18:00:00.000Z"))).toBe(true);
  });

  it("misura la soglia sul ritmo scelto, non su un tempo fisso", () => {
    // Dodici ore sono un guasto per «ogni ora» e la normalità per «ogni giorno».
    const dodiciOreFa = new Date("2026-08-31T06:00:00.000Z");

    expect(stalled("hourly", dodiciOreFa)).toBe(true);
    expect(stalled("daily", dodiciOreFa)).toBe(false);
  });
});

describe("come si racconta un ritmo", () => {
  it("dice ogni quanto, senza gergo", () => {
    expect(describeSchedule("manual")).toContain("Leggi ora");
    expect(describeSchedule("daily")).toBe("una volta al giorno");
  });

  it("conta le letture al mese, che è il costo che si paga", () => {
    /*
     * Fra «ogni ora» e «una volta al giorno» c'è un fattore ventiquattro sulla
     * quota di chiamate del cliente. È una differenza che chi sceglie ha il
     * diritto di vedere **mentre** sceglie, non a fine mese.
     */
    expect(readsPerMonth("manual")).toBe(0);
    expect(readsPerMonth("daily")).toBe(30);
    expect(readsPerMonth("every-4-hours")).toBe(180);
    expect(readsPerMonth("hourly")).toBe(720);
  });
});
