import type { SyncSchedule } from "@/domain";

/**
 * Quando tocca rileggere, e quando no.
 *
 * **Un solo timer esterno, la decisione qui.** Lo schedulatore chiama il portale
 * a intervalli fissi e non sa nulla dei progetti; è questo codice a stabilire
 * quali siano scaduti. L'alternativa — un'iscrizione a QStash per ogni progetto
 * — metterebbe la configurazione in due posti, e il giorno in cui qualcuno
 * cambia il ritmo dall'interfaccia il servizio esterno resterebbe indietro senza
 * che nulla lo segnali.
 *
 * Funzione pura, con l'istante come argomento (ADR-0002): una funzione che legge
 * l'orologio non si può provare, e questa decide quanto si spende.
 */

/**
 * Ogni quante ore, per ciascun ritmo.
 *
 * `manual` non compare: non è un intervallo lungo, è l'assenza di un intervallo,
 * e trattarlo come «ogni mille anni» renderebbe possibile il giorno in cui un
 * arrotondamento lo fa scattare.
 */
const HOURS: Readonly<Record<Exclude<SyncSchedule, "manual">, number>> = {
  hourly: 1,
  "every-4-hours": 4,
  daily: 24,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Quanto si concede di tolleranza sull'intervallo.
 *
 * Lo schedulatore non chiama mai a intervalli perfetti: se scatta 59 minuti e 40
 * secondi dopo l'ultima lettura oraria, un confronto rigido salterebbe il giro
 * e il ritmo reale diventerebbe di due ore. Con un minuto di tolleranza il
 * risultato non è mai in anticipo di nulla che si noti, e non slitta.
 */
const TOLERANCE_MS = 60 * 1000;

export type DueInput = {
  readonly schedule: SyncSchedule;
  readonly lastSyncedAt: Date | null;
  readonly now: Date;
};

export function isDue(input: DueInput): boolean {
  if (input.schedule === "manual") return false;

  /*
   * Un progetto mai letto è scaduto, qualunque sia il ritmo.
   *
   * È il caso di chi accende l'automatismo su un progetto appena collegato: la
   * prima lettura è quella che porta tutta la storia, ed è anche la sola che
   * rende la schermata diversa da vuota. Aspettare l'intervallo significherebbe
   * far vedere un portale vuoto per ventiquattr'ore a chi ha appena finito di
   * configurare tutto.
   */
  if (input.lastSyncedAt === null) return true;

  const elapsed = input.now.getTime() - input.lastSyncedAt.getTime();

  /*
   * Un segnatempo nel futuro non è scaduto.
   *
   * Con due orologi sfasati `elapsed` diventa negativo, e trattarlo come «tanto
   * tempo fa» farebbe leggere a ogni giro. Aspettare è la risposta prudente
   * quando il tempo non torna.
   */
  return elapsed + TOLERANCE_MS >= HOURS[input.schedule] * HOUR_MS;
}

/** Il ritmo, detto come si legge su una schermata. */
export function describeSchedule(schedule: SyncSchedule): string {
  switch (schedule) {
    case "manual":
      return "solo quando premi «Leggi ora»";
    case "hourly":
      return "ogni ora";
    case "every-4-hours":
      return "ogni quattro ore";
    case "daily":
      return "una volta al giorno";
  }
}

/**
 * Quante letture al mese costa un ritmo.
 *
 * Serve a rendere visibile ciò che altrimenti si scopre a fine mese: la quota di
 * chiamate a Jira è del cliente, e la differenza fra «ogni ora» e «una volta al
 * giorno» è di un fattore ventiquattro.
 */
export function readsPerMonth(schedule: SyncSchedule): number {
  if (schedule === "manual") return 0;

  return Math.round((30 * 24) / HOURS[schedule]);
}
