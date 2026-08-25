import { describe, expect, it } from "vitest";

import {
  sprintStatisticsSchema,
  MAX_FORECAST_POINTS,
} from "@/domain";

/**
 * Il documento delle statistiche di sprint.
 *
 * Il capitolo 16 lo nomina due volte, una per estremo dello sprint. Qui si
 * verifica la sola cosa che uno schema può verificare — la forma — più la
 * decisione che lo rende difendibile: **non contiene la velocity effettiva**.
 */

const BASE = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
  sprintId: "2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35",
  recordedAt: "2026-04-06T08:00:00.000Z",
  forecastPoints: 42,
  method: "yesterdays-weather" as const,
  focusFactor: null,
  teamSize: 5,
  workingDays: 10,
  createdAt: "2026-04-06T08:00:00.000Z",
  updatedAt: "2026-04-06T08:00:00.000Z",
};

describe("statistiche di sprint", () => {
  it("accetta una previsione col meteo di ieri, senza focus factor", () => {
    const entry = sprintStatisticsSchema.parse(BASE);

    expect(entry.forecastPoints).toBe(42);
    expect(entry.method).toBe("yesterdays-weather");
    // Il meteo di ieri non calcola un focus factor, e dedurne uno
    // inventerebbe una precisione che il metodo non dichiara.
    expect(entry.focusFactor).toBeNull();
  });

  it("conserva il focus factor quando il metodo ne usa uno", () => {
    const entry = sprintStatisticsSchema.parse({
      ...BASE,
      method: "focus-factor",
      focusFactor: 0.4,
    });

    expect(entry.focusFactor).toBe(0.4);
  });

  it("non contiene la velocity effettiva, ed è una decisione", () => {
    /*
     * La regola: **si conserva ciò che non si può recuperare, si ricalcola ciò
     * che si può.**
     *
     * Una previsione è un'affermazione fatta a un istante: rifarla oggi non è
     * ricordarla, è deciderla di nuovo con dati che allora non esistevano. La
     * velocity effettiva, da quando `EstimateChange` la ancora alle stime
     * d'ingresso, è invece **stabile**: conservarne una copia creerebbe una
     * seconda verità che può discostarsi dalla prima, e il giorno in cui non
     * coincidono non c'è modo di sapere quale sbaglia.
     *
     * Questo test esiste perché aggiungere quel campo sembrerà comodo.
     */
    const entry = sprintStatisticsSchema.parse(BASE);

    expect(Object.keys(entry)).not.toContain("actualVelocity");
    expect(Object.keys(entry)).not.toContain("variance");
  });

  it("rifiuta un metodo che non esiste", () => {
    // Insieme chiuso: il metodo finisce a schermo e ne governa la spiegazione.
    expect(() =>
      sprintStatisticsSchema.parse({ ...BASE, method: "a occhio" }),
    ).toThrow();
  });

  it("rifiuta una previsione negativa", () => {
    expect(() =>
      sprintStatisticsSchema.parse({ ...BASE, forecastPoints: -1 }),
    ).toThrow();
  });

  it("rifiuta una previsione oltre il tetto, che sarebbe un errore di battitura", () => {
    expect(() =>
      sprintStatisticsSchema.parse({
        ...BASE,
        forecastPoints: MAX_FORECAST_POINTS + 1,
      }),
    ).toThrow();
  });

  it("ammette una previsione con decimali", () => {
    // È una media di sprint passati: arrotondarla in scrittura butterebbe via
    // precisione e la farebbe divergere da ciò che il motore calcola.
    const entry = sprintStatisticsSchema.parse({ ...BASE, forecastPoints: 17.5 });
    expect(entry.forecastPoints).toBe(17.5);
  });

  it("registra la dimensione della squadra come numero, mai come elenco", () => {
    /*
     * Il libro annota la dimensione perché spiega una variazione di velocity.
     * *Chi* c'era è un'altra domanda, e porta dritta alle cifre per persona che
     * §8.2 vieta.
     */
    const entry = sprintStatisticsSchema.parse(BASE);

    expect(typeof entry.teamSize).toBe("number");
    expect(Object.keys(entry)).not.toContain("members");
  });

  it("rifiuta una dimensione della squadra frazionaria", () => {
    expect(() => sprintStatisticsSchema.parse({ ...BASE, teamSize: 2.5 })).toThrow();
  });
});
