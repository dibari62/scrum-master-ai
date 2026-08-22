import { describe, expect, it } from "vitest";

import { typicalSprintLengthDays } from "@/metrics";
import { sprintSchema, type Sprint } from "@/domain";

/**
 * The sprint length the wizard proposes (criterio 10).
 *
 * Lives in `src/metrics` and is tested here because R1 puts every calculation
 * in deterministic, tested code — including the modest ones. A wizard that
 * worked it out inline would be a calculation nobody could check.
 */

const IDS = {
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
};

let counter = 0;

function aSprint(startsAt: string, endsAt: string): Sprint {
  counter += 1;

  return sprintSchema.parse({
    id: `2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e${String(counter).padStart(2, "0")}`,
    ...IDS,
    sourceSystem: "seed",
    sourceId: `sprint-${counter}`,
    name: `Sprint ${counter}`,
    goal: null,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    completedAt: null,
    createdAt: new Date(startsAt),
    updatedAt: new Date(endsAt),
  });
}

describe("durata tipica dello sprint", () => {
  it("non è disponibile senza sprint", () => {
    expect(typicalSprintLengthDays([]).available).toBe(false);
  });

  it("non è disponibile con un solo sprint", () => {
    // Un'osservazione non è un'abitudine: presentarla come tale farebbe
    // sembrare una coincidenza una scelta della squadra.
    const uno = [aSprint("2026-04-06T00:00:00Z", "2026-04-19T00:00:00Z")];

    expect(typicalSprintLengthDays(uno).available).toBe(false);
  });

  it("è la mediana delle durate osservate", () => {
    const sprints = [
      aSprint("2026-04-06T00:00:00Z", "2026-04-20T00:00:00Z"), // 14
      aSprint("2026-04-20T00:00:00Z", "2026-05-04T00:00:00Z"), // 14
      aSprint("2026-05-04T00:00:00Z", "2026-05-18T00:00:00Z"), // 14
    ];

    const result = typicalSprintLengthDays(sprints);

    expect(result.available).toBe(true);
    if (result.available) expect(result.value).toBe(14);
  });

  it("la mediana regge uno sprint anomalo, dove una media cederebbe", () => {
    /*
     * Il caso per cui la mediana esiste: uno sprint accorciato da una
     * festività trascinerebbe la media lontano dalla durata a cui la squadra
     * lavora davvero, che è il valore richiesto.
     */
    const sprints = [
      aSprint("2026-04-06T00:00:00Z", "2026-04-20T00:00:00Z"), // 14
      aSprint("2026-04-20T00:00:00Z", "2026-04-23T00:00:00Z"), // 3, accorciato
      aSprint("2026-04-23T00:00:00Z", "2026-05-07T00:00:00Z"), // 14
    ];

    const result = typicalSprintLengthDays(sprints);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(14);
  });

  it("esclude uno sprint che finisce prima di iniziare, invece di appiattirlo a zero", () => {
    // Trattarlo come zero giorni lascerebbe che un difetto della fonte
    // accorci in silenzio la proposta.
    const sprints = [
      aSprint("2026-04-06T00:00:00Z", "2026-04-20T00:00:00Z"),
      aSprint("2026-04-20T00:00:00Z", "2026-05-04T00:00:00Z"),
      aSprint("2026-05-18T00:00:00Z", "2026-05-04T00:00:00Z"), // invertito
    ];

    const result = typicalSprintLengthDays(sprints);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(14);
    // Il campione dichiara quanti sprint hanno davvero contribuito.
    expect(result.sampleSize).toBe(2);
  });

  it("propone almeno un giorno, mai zero", () => {
    const brevissimi = [
      aSprint("2026-04-06T00:00:00Z", "2026-04-06T02:00:00Z"),
      aSprint("2026-04-07T00:00:00Z", "2026-04-07T02:00:00Z"),
    ];

    const result = typicalSprintLengthDays(brevissimi);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBeGreaterThanOrEqual(1);
  });

  it("arrotonda a giorni interi: mezza giornata di sprint non si propone", () => {
    const sprints = [
      aSprint("2026-04-06T00:00:00Z", "2026-04-16T12:00:00Z"), // 10,5
      aSprint("2026-04-17T00:00:00Z", "2026-04-27T12:00:00Z"), // 10,5
    ];

    const result = typicalSprintLengthDays(sprints);

    if (!result.available) throw new Error("attesa disponibile");
    expect(Number.isInteger(result.value)).toBe(true);
  });
});
