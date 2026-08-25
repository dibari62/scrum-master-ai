import { describe, expect, it } from "vitest";

import {
  countWorkingDays,
  dayOfWeekOf,
  DEFAULT_WORKING_CALENDAR,
  isWorkingDay,
  toCalendarDate,
  workingCalendarSchema,
  workingDayInstants,
} from "@/domain";

/**
 * Il calendario lavorativo.
 *
 * Esiste per una ragione sola, ed è un difetto vero: il burndown campionava
 * ogni giorno di calendario mentre i dati sintetici saltano i fine settimana,
 * quindi il grafico disegnava altopiani piatti nei giorni in cui non lavora
 * nessuno. Kniberg racconta di aver fatto e disfatto lo stesso errore: la
 * piattezza del fine settimana «would look like a warning sign» (pag. 62).
 */
describe("giorno della settimana", () => {
  it("nomina i giorni invece di numerarli", () => {
    // 6 aprile 2026 è un lunedì. La corrispondenza fra il numero che
    // restituisce getUTCDay() e il nome è arbitraria, ed è esattamente il
    // motivo per cui DayOfWeek è un nome e non un indice.
    expect(dayOfWeekOf(new Date("2026-04-06T08:00:00.000Z"))).toBe("monday");
    expect(dayOfWeekOf(new Date("2026-04-11T08:00:00.000Z"))).toBe("saturday");
    expect(dayOfWeekOf(new Date("2026-04-12T08:00:00.000Z"))).toBe("sunday");
  });

  it("legge sempre in UTC, non nel fuso di chi esegue", () => {
    // Un istante che in Europa è già martedì ma in UTC è ancora lunedì.
    expect(dayOfWeekOf(new Date("2026-04-06T23:30:00.000Z"))).toBe("monday");
    expect(toCalendarDate(new Date("2026-04-06T23:30:00.000Z"))).toBe("2026-04-06");
  });
});

describe("isWorkingDay", () => {
  it("il predefinito lavora da lunedì a venerdì", () => {
    expect(isWorkingDay(DEFAULT_WORKING_CALENDAR, new Date("2026-04-06T08:00:00.000Z"))).toBe(true);
    expect(isWorkingDay(DEFAULT_WORKING_CALENDAR, new Date("2026-04-10T08:00:00.000Z"))).toBe(true);
    expect(isWorkingDay(DEFAULT_WORKING_CALENDAR, new Date("2026-04-11T08:00:00.000Z"))).toBe(false);
    expect(isWorkingDay(DEFAULT_WORKING_CALENDAR, new Date("2026-04-12T08:00:00.000Z"))).toBe(false);
  });

  it("una festività dichiarata non è un giorno lavorativo", () => {
    const calendar = { ...DEFAULT_WORKING_CALENDAR, holidays: ["2026-04-07"] };

    expect(isWorkingDay(calendar, new Date("2026-04-07T08:00:00.000Z"))).toBe(false);
    expect(isWorkingDay(calendar, new Date("2026-04-08T08:00:00.000Z"))).toBe(true);
  });

  it("un progetto può lavorare il sabato", () => {
    // Non è un caso di scuola: il presupposto «lunedì-venerdì» è un
    // predefinito, non una legge, e chi lavora il sabato deve vedere il
    // sabato sul grafico.
    const calendar = workingCalendarSchema.parse({
      workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      holidays: [],
    });

    expect(isWorkingDay(calendar, new Date("2026-04-11T08:00:00.000Z"))).toBe(true);
  });
});

describe("workingDayInstants", () => {
  it("conserva l'ora del giorno", () => {
    /*
     * Il campione è all'ora di inizio dello sprint e non a mezzanotte, così
     * ogni punto risponde a «dov'eravamo ieri a quest'ora» — il confronto che
     * un team fa davvero. A mezzanotte UTC, per una squadra europea, si
     * guarderebbe la sera prima.
     */
    const instants = workingDayInstants(
      DEFAULT_WORKING_CALENDAR,
      new Date("2026-04-06T08:00:00.000Z"),
      new Date("2026-04-08T08:00:00.000Z"),
    );

    expect(instants.map((instant) => instant.toISOString())).toEqual([
      "2026-04-06T08:00:00.000Z",
      "2026-04-07T08:00:00.000Z",
      "2026-04-08T08:00:00.000Z",
    ]);
  });

  it("salta il fine settimana senza spostare l'ora", () => {
    const instants = workingDayInstants(
      DEFAULT_WORKING_CALENDAR,
      new Date("2026-04-10T08:00:00.000Z"),
      new Date("2026-04-13T08:00:00.000Z"),
    );

    expect(instants.map((instant) => instant.toISOString())).toEqual([
      "2026-04-10T08:00:00.000Z",
      "2026-04-13T08:00:00.000Z",
    ]);
  });

  it("un intervallo rovesciato è una domanda legittima senza risposta", () => {
    // Uno sprint interrogato prima che cominciasse: nessun giorno, non un
    // errore.
    expect(
      workingDayInstants(
        DEFAULT_WORKING_CALENDAR,
        new Date("2026-04-10T08:00:00.000Z"),
        new Date("2026-04-06T08:00:00.000Z"),
      ),
    ).toHaveLength(0);
  });

  it("attraversa il cambio di ora legale senza perdere né duplicare un giorno", () => {
    /*
     * Caso limite obbligatorio delle istruzioni sulle metriche. Qui è gratis,
     * e vale la pena dire perché: tutto è in UTC, e UTC non ha ora legale.
     * Sommare esattamente ventiquattro ore non può quindi far ricadere due
     * volte sullo stesso giorno né saltarne uno — cosa che invece succede
     * lavorando in un fuso locale.
     *
     * In Europa il cambio del 2026 è domenica 29 marzo.
     */
    const instants = workingDayInstants(
      DEFAULT_WORKING_CALENDAR,
      new Date("2026-03-27T08:00:00.000Z"),
      new Date("2026-03-31T08:00:00.000Z"),
    );

    expect(instants.map((instant) => instant.toISOString())).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-30T08:00:00.000Z",
      "2026-03-31T08:00:00.000Z",
    ]);
  });
});

describe("countWorkingDays", () => {
  it("conta i quindici giorni dello sprint di tre settimane del libro", () => {
    /*
     * «our sprint length will be three weeks (15 days) long» (pag. 99).
     *
     * Ventuno giorni di calendario, quindici lavorativi: è questo il numero
     * che moltiplica la squadra per ottenere i man-days disponibili, e
     * confonderlo con i giorni di calendario gonfierebbe la capacità del
     * quaranta per cento.
     */
    const days = countWorkingDays(
      DEFAULT_WORKING_CALENDAR,
      new Date("2026-04-06T08:00:00.000Z"),
      new Date("2026-04-24T18:00:00.000Z"),
    );

    expect(days).toBe(15);
  });
});

describe("schema del calendario", () => {
  it("rifiuta un calendario senza giorni lavorativi", () => {
    // Un calendario che non lavora mai renderebbe ogni ciclo o vuoto o
    // infinito, a seconda di come è scritto. Rifiutarlo qui significa che
    // nessun chiamante deve difendersene.
    expect(() =>
      workingCalendarSchema.parse({ workingDays: [], holidays: [] }),
    ).toThrow();
  });

  it("rifiuta lo stesso giorno due volte", () => {
    expect(() =>
      workingCalendarSchema.parse({ workingDays: ["monday", "monday"], holidays: [] }),
    ).toThrow();
  });

  it("rifiuta una festività che non è una data", () => {
    expect(() =>
      workingCalendarSchema.parse({ workingDays: ["monday"], holidays: ["7 aprile"] }),
    ).toThrow();
  });
});
