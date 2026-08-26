import { describe, expect, it } from "vitest";

import {
  improvementFollowUp,
  improvementLeadTime,
  improvementsByPriority,
} from "@/metrics";
import {
  improvementActionSchema,
  retrospectiveSchema,
  type ImprovementAction,
  type ImprovementStatus,
  type Retrospective,
} from "@/domain";

/**
 * Il seguito dei miglioramenti.
 *
 * È l'unica domanda che vale la pena porre a una retrospettiva: «Focus on just
 * a few improvements per sprint» significa qualcosa solo se poi qualcuno
 * controlla che quei pochi siano avvenuti.
 */

const SCOPE = {
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
} as const;

const RETRO_A = "11111111-0000-4000-8000-000000000001";
const RETRO_B = "22222222-0000-4000-8000-000000000002";

let counter = 0;

function action(
  status: ImprovementStatus,
  overrides: Partial<{
    votes: number;
    decidedAt: string;
    resolvedAt: string | null;
    retrospectiveId: string;
    title: string;
  }> = {},
): ImprovementAction {
  counter += 1;
  const decidedAt = overrides.decidedAt ?? "2026-04-01T16:00:00.000Z";

  return improvementActionSchema.parse({
    id: `aaaaaaaa-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    ...SCOPE,
    retrospectiveId: overrides.retrospectiveId ?? RETRO_A,
    title: overrides.title ?? `Miglioramento ${counter}`,
    detail: null,
    votes: overrides.votes ?? 0,
    status,
    resolvedAt: overrides.resolvedAt === undefined ? null : overrides.resolvedAt,
    createdAt: decidedAt,
    updatedAt: decidedAt,
  });
}

function retrospective(id: string, participantCount = 5): Retrospective {
  return retrospectiveSchema.parse({
    id,
    ...SCOPE,
    sprintId: "2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35",
    heldAt: "2026-04-01T16:00:00.000Z",
    participantCount,
    createdAt: "2026-04-01T16:00:00.000Z",
    updatedAt: "2026-04-01T16:00:00.000Z",
  });
}

const ASOF = new Date("2026-04-21T10:00:00.000Z");

/** Le durate del motore sono in millisecondi: si arrotonda solo a schermo. */
const DAY = 24 * 60 * 60 * 1000;

describe("improvementFollowUp", () => {
  it("conta aperti, fatti e lasciati cadere", () => {
    const result = improvementFollowUp(
      [action("open"), action("done", { resolvedAt: "2026-04-10T10:00:00.000Z" }), action("dropped")],
      ASOF,
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.openCount).toBe(1);
    expect(result.value.doneCount).toBe(1);
    expect(result.value.droppedCount).toBe(1);
  });

  it("esclude i lasciati cadere dal denominatore", () => {
    /*
     * Il libro ammette esplicitamente di decidere di non agire: «in many cases,
     * just identifying a problem clearly is enough for it to solve itself».
     * Contarli come fallimenti spingerebbe una squadra a dichiarare di aver
     * fatto qualcosa invece di ammettere che non serviva.
     */
    const result = improvementFollowUp(
      [
        action("done", { resolvedAt: "2026-04-10T10:00:00.000Z" }),
        action("dropped"),
        action("dropped"),
      ],
      ASOF,
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.consideredCount).toBe(1);
    expect(result.value.completionShare).toBe(1);
  });

  it("senza nulla da considerare non riporta una quota di zero", () => {
    // Una squadra che ha lasciato cadere tutto non ha una quota di
    // completamento; scrivere 0% la farebbe sembrare una che ci ha provato e
    // ha fallito.
    const result = improvementFollowUp([action("dropped")], ASOF);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.completionShare).toBeNull();
  });

  it("dice da quanto è aperto quello più vecchio", () => {
    const result = improvementFollowUp(
      [
        action("open", { decidedAt: "2026-04-01T10:00:00.000Z" }),
        action("open", { decidedAt: "2026-04-15T10:00:00.000Z" }),
      ],
      ASOF,
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.longestOpenMs).toBe(20 * DAY);
  });

  it("senza nulla di aperto non inventa un'anzianità", () => {
    const result = improvementFollowUp(
      [action("done", { resolvedAt: "2026-04-10T10:00:00.000Z" })],
      ASOF,
    );

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value.longestOpenMs).toBeNull();
  });

  it("senza alcun miglioramento dichiara la lacuna invece di rispondere zero", () => {
    const result = improvementFollowUp([], ASOF);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-data");
  });

  it("non legge l'orologio: lo stesso insieme a due istanti dà due anzianità", () => {
    // ADR-0002 reso verificabile. Una funzione che leggesse l'ora corrente
    // risponderebbe diversamente a ogni esecuzione e non sarebbe testabile.
    const actions = [action("open", { decidedAt: "2026-04-01T10:00:00.000Z" })];

    const early = improvementFollowUp(actions, new Date("2026-04-06T10:00:00.000Z"));
    const late = improvementFollowUp(actions, new Date("2026-04-21T10:00:00.000Z"));

    if (!early.available || !late.available) throw new Error("attese disponibili");
    expect(early.value.longestOpenMs).toBe(5 * DAY);
    expect(late.value.longestOpenMs).toBe(20 * DAY);
  });
});

describe("improvementLeadTime", () => {
  it("media solo i miglioramenti chiusi", () => {
    /*
     * Includere gli aperti con «tempo finora» mescolerebbe due misure diverse,
     * e renderebbe una squadra più veloce quanto più lascia aperto.
     */
    const result = improvementLeadTime([
      action("done", {
        decidedAt: "2026-04-01T10:00:00.000Z",
        resolvedAt: "2026-04-05T10:00:00.000Z",
      }),
      action("done", {
        decidedAt: "2026-04-01T10:00:00.000Z",
        resolvedAt: "2026-04-11T10:00:00.000Z",
      }),
      action("open", { decidedAt: "2026-01-01T10:00:00.000Z" }),
    ]);

    if (!result.available) throw new Error("attesa disponibile");
    expect(result.value).toBe(7 * DAY);
  });

  it("senza nulla di chiuso non inventa una durata", () => {
    const result = improvementLeadTime([action("open")]);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("attesa indisponibile");
    expect(result.reason).toBe("no-qualifying-data");
  });

  it("scarta una durata negativa invece di mediarla", () => {
    // Chiuso prima di essere deciso: è un difetto della fonte, non una durata.
    const result = improvementLeadTime([
      action("done", {
        decidedAt: "2026-04-10T10:00:00.000Z",
        resolvedAt: "2026-04-01T10:00:00.000Z",
      }),
    ]);

    expect(result.available).toBe(false);
  });
});

describe("improvementsByPriority", () => {
  it("ordina per voti, come sulla lavagna", () => {
    const actions = [
      action("open", { votes: 3, title: "terzo" }),
      action("open", { votes: 11, title: "primo" }),
      action("open", { votes: 7, title: "secondo" }),
    ];

    const ordered = improvementsByPriority(actions, retrospective(RETRO_A));
    expect(ordered.map((entry) => entry.title)).toEqual(["primo", "secondo", "terzo"]);
  });

  it("a parità di voti conserva l'ordine ricevuto", () => {
    // Un elenco che si rimescola fra due letture insegna che l'ordine non
    // significa niente, ed è esattamente ciò che l'ordinamento per voti vuole
    // comunicare.
    const actions = [
      action("open", { votes: 4, title: "primo arrivato" }),
      action("open", { votes: 4, title: "secondo arrivato" }),
    ];

    const ordered = improvementsByPriority(actions, retrospective(RETRO_A));
    expect(ordered.map((entry) => entry.title)).toEqual([
      "primo arrivato",
      "secondo arrivato",
    ]);
  });

  it("ignora i miglioramenti di un'altra retrospettiva", () => {
    const actions = [
      action("open", { votes: 9, title: "di A" }),
      action("open", { votes: 12, title: "di B", retrospectiveId: RETRO_B }),
    ];

    const ordered = improvementsByPriority(actions, retrospective(RETRO_A));
    expect(ordered.map((entry) => entry.title)).toEqual(["di A"]);
  });
});
