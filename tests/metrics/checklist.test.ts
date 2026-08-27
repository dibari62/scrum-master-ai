import { beforeEach, describe, expect, it } from "vitest";

import {
  impedimentSchema,
  retrospectiveSchema,
  sprintSchema,
  sprintStatisticsSchema,
} from "@/domain";
import { CHECKLIST_MOMENTS, scrumMasterChecklist } from "@/metrics";

import { move, resetIds, uuidFor } from "./builders";

const SCOPE = {
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
} as const;

const SPRINT_ID = "5c9e7b21-3f4a-4d68-9b17-2e8c6a0f4d33";
const ITEM_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function sprint(overrides: Partial<{ goal: string | null; completedAt: string | null }> = {}) {
  return sprintSchema.parse({
    id: SPRINT_ID,
    ...SCOPE,
    sourceSystem: "seed",
    sourceId: "sprint-1",
    name: "Sprint 1",
    goal: overrides.goal === undefined ? "Chiudere il checkout" : overrides.goal,
    startsAt: "2026-04-06T08:00:00.000Z",
    endsAt: "2026-04-17T17:00:00.000Z",
    completedAt: overrides.completedAt === undefined ? null : overrides.completedAt,
    createdAt: "2026-04-06T08:00:00.000Z",
    updatedAt: "2026-04-06T08:00:00.000Z",
  });
}

function base(overrides: Partial<Parameters<typeof scrumMasterChecklist>[0]> = {}) {
  return scrumMasterChecklist({
    sprint: sprint(),
    transitions: [],
    scopeEvents: [],
    impediments: [],
    retrospectives: [],
    statistics: [],
    asOf: new Date("2026-04-10T09:00:00.000Z"),
    ...overrides,
  });
}

const find = (entries: ReturnType<typeof base>, id: string) =>
  entries.find((entry) => entry.id === id);

describe("scrumMasterChecklist — la forma della checklist", () => {
  beforeEach(resetIds);

  it("riporta le quattordici voci del capitolo 16", () => {
    expect(base()).toHaveLength(14);
  });

  it("le raggruppa nei tre momenti che il libro elenca", () => {
    const moments = new Set(base().map((entry) => entry.moment));

    expect([...moments].sort()).toEqual([...CHECKLIST_MOMENTS].sort());
  });

  it("ogni voce dice anche perché, non solo se", () => {
    // Una spunta senza motivo non si può controllare: chi legge deve poter
    // risalire al fatto invece di fidarsi.
    for (const entry of base()) {
      expect(entry.detail.length, `la voce «${entry.id}» non spiega nulla`).toBeGreaterThan(0);
    }
  });

  it("mostra anche ciò che non può verificare, invece di ometterlo", () => {
    /*
     * Metà del lavoro dello Scrum Master non lascia traccia in un database:
     * «stampa la pagina e appendila al muro», «il daily inizia in orario».
     *
     * Ometterle farebbe sembrare quel lavoro più piccolo di quanto sia;
     * spuntarle da sole sarebbe una bugia. Restano, marcate come umane.
     */
    const human = base().filter((entry) => entry.status === "human");

    expect(human.length).toBeGreaterThan(0);
    expect(human.map((entry) => entry.id)).toContain("print");
    expect(human.map((entry) => entry.id)).toContain("daily-on-time");
  });

  it("non spunta mai da sola una voce che nessun dato può sostenere", () => {
    // La condizione che rende vero il test precedente, detta a parte perché
    // quando fallirà dirà *perché*.
    const cannotKnow = ["print", "wiki-link", "announce", "daily-on-time", "po-informed", "demo"];

    for (const id of cannotKnow) {
      expect(find(base(), id)?.status, `«${id}» non può essere «fatto»`).toBe("human");
    }
  });
});

describe("scrumMasterChecklist — ciò che il portale sa davvero", () => {
  beforeEach(resetIds);

  it("la pagina informativa è pronta solo se lo sprint ha un obiettivo", () => {
    expect(find(base(), "info-page")?.status).toBe("done");
    expect(find(base({ sprint: sprint({ goal: null }) }), "info-page")?.status).toBe("todo");
  });

  it("le statistiche d'inizio sono fatte se c'è una previsione registrata", () => {
    expect(find(base(), "statistics-start")?.status).toBe("todo");

    const statistics = [
      sprintStatisticsSchema.parse({
        id: uuidFor("stat"),
        ...SCOPE,
        sprintId: SPRINT_ID,
        recordedAt: "2026-04-06T09:00:00.000Z",
        forecastPoints: 40,
        method: "yesterdays-weather",
        focusFactor: null,
        teamSize: 5,
        workingDays: 10,
        createdAt: "2026-04-06T09:00:00.000Z",
        updatedAt: "2026-04-06T09:00:00.000Z",
      }),
    ];

    expect(find(base({ statistics }), "statistics-start")?.status).toBe("done");
  });

  it("un impedimento aperto rende la voce da fare, e dice quanti", () => {
    const impediments = [
      impedimentSchema.parse({
        id: uuidFor("imp"),
        ...SCOPE,
        sourceSystem: "seed",
        sourceId: "imp-1",
        title: "Ambiente di collaudo fermo",
        description: null,
        workItemId: null,
        raisedAt: "2026-04-08T09:00:00.000Z",
        resolvedAt: null,
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:00.000Z",
      }),
    ];

    const entry = find(base({ impediments }), "impediments");

    expect(entry?.status).toBe("todo");
    expect(entry?.detail).toContain("1");
  });

  it("una lavagna ferma da giorni non risulta aggiornata", () => {
    /*
     * Non «quante transizioni ci sono» ma «quando è stata l'ultima»: una
     * squadra che ha lavorato molto la settimana scorsa e nulla da tre giorni
     * ha una lavagna ferma, e il conteggio totale non lo direbbe.
     */
    const stale = [move(null, "todo", "2026-04-06T09:00:00.000Z", { workItemId: ITEM_ID })];

    expect(find(base({ transitions: stale }), "board-fresh")?.status).toBe("todo");

    const fresh = [move(null, "todo", "2026-04-09T18:00:00.000Z", { workItemId: ITEM_ID })];
    expect(find(base({ transitions: fresh }), "board-fresh")?.status).toBe("done");
  });

  it("il fine settimana non fa sembrare ferma una lavagna che non lo è", () => {
    // Due giorni di tolleranza, non uno: altrimenti ogni lunedì mattina
    // riporterebbe una lavagna ferma, che è un fatto sul calendario e non
    // sulla squadra.
    const friday = [move(null, "todo", "2026-04-10T17:00:00.000Z", { workItemId: ITEM_ID })];

    const monday = base({
      transitions: friday,
      asOf: new Date("2026-04-12T09:00:00.000Z"),
    });

    expect(find(monday, "board-fresh")?.status).toBe("done");
  });
});

describe("scrumMasterChecklist — le voci di fine sprint", () => {
  beforeEach(resetIds);

  it("non chiede la retrospettiva di uno sprint ancora aperto", () => {
    /*
     * «Non ancora» non è «da fare».
     *
     * Una retrospettiva su uno sprint in corso guarderebbe indietro a qualcosa
     * che non è ancora successo, e segnarla come mancante insegnerebbe a
     * ignorare la checklist nella metà dei giorni.
     */
    expect(find(base(), "retrospective")?.status).toBe("not-yet");
  });

  it("uno sprint chiuso senza retrospettiva la dichiara mancante", () => {
    const closed = base({
      sprint: sprint({ completedAt: "2026-04-17T17:00:00.000Z" }),
      asOf: new Date("2026-04-20T09:00:00.000Z"),
    });

    expect(find(closed, "retrospective")?.status).toBe("todo");
  });

  it("con la retrospettiva tenuta, la voce è fatta e dice quando", () => {
    const retrospectives = [
      retrospectiveSchema.parse({
        id: uuidFor("retro"),
        ...SCOPE,
        sprintId: SPRINT_ID,
        heldAt: "2026-04-17T16:00:00.000Z",
        participantCount: 5,
        createdAt: "2026-04-17T16:00:00.000Z",
        updatedAt: "2026-04-17T16:00:00.000Z",
      }),
    ];

    const entry = find(
      base({
        sprint: sprint({ completedAt: "2026-04-17T17:00:00.000Z" }),
        retrospectives,
        asOf: new Date("2026-04-20T09:00:00.000Z"),
      }),
      "retrospective",
    );

    expect(entry?.status).toBe("done");
    expect(entry?.detail).toContain("5");
  });

  it("l'avviso della demo compare solo quando è il momento", () => {
    /*
     * > «Everyone should be notified about the demo **a day or two before**.»
     *
     * Un avviso che resta acceso per due settimane insegna a ignorarlo. Fuori
     * dalla finestra è «non ancora», non «da fare».
     */
    expect(find(base(), "demo-notice")?.status).toBe("not-yet");

    const twoDaysBefore = base({ asOf: new Date("2026-04-15T09:00:00.000Z") });
    expect(find(twoDaysBefore, "demo-notice")?.status).toBe("todo");
  });

  it("senza retrospettiva le statistiche di fine restano da fare, e dicono perché", () => {
    /*
     * Il significato di questo «da fare» è cambiato, ed è la ragione per cui il
     * test è stato riscritto invece di lasciato passare.
     *
     * Prima diceva «il collegamento fra retrospettiva e statistiche non
     * esiste»: era un debito nostro, e la voce restava rossa qualunque cosa
     * facesse la squadra. Ora il collegamento c'è, quindi rosso significa
     * l'unica cosa che dovrebbe significare — **manca la retrospettiva**, ed è
     * un lavoro di chi legge la checklist, non nostro.
     */
    const entry = find(
      base({
        sprint: sprint({ completedAt: "2026-04-17T17:00:00.000Z" }),
        asOf: new Date("2026-04-20T09:00:00.000Z"),
      }),
      "statistics-end",
    );

    expect(entry?.status).toBe("todo");
    expect(entry?.detail).toContain("Manca la retrospettiva");
  });

  it("con la retrospettiva tenuta, le statistiche di fine sono complete", () => {
    /*
     * > «Update the sprint statistics page with the actual velocity **and key
     * > points from the retrospective**» (pag. 163)
     *
     * Entrambe le metà ci sono: la velocity effettiva si ricalcola dai dati, e
     * i punti chiave compaiono accanto alle statistiche letti dall'entità che
     * li contiene — non ricopiati, perché una trascrizione diverge
     * dall'originale alla prima correzione.
     */
    const retrospectives = [
      retrospectiveSchema.parse({
        id: uuidFor("retro-completa"),
        ...SCOPE,
        sprintId: SPRINT_ID,
        heldAt: "2026-04-17T16:00:00.000Z",
        participantCount: 5,
        createdAt: "2026-04-17T16:00:00.000Z",
        updatedAt: "2026-04-17T16:00:00.000Z",
      }),
    ];

    const entry = find(
      base({
        sprint: sprint({ completedAt: "2026-04-17T17:00:00.000Z" }),
        retrospectives,
        asOf: new Date("2026-04-20T09:00:00.000Z"),
      }),
      "statistics-end",
    );

    expect(entry?.status).toBe("done");
  });
});
