import { beforeEach, describe, expect, it } from "vitest";

import {
  boardColumnSchema,
  sprintSchema,
  sprintScopeEventSchema,
  type BoardColumn,
  type Sprint,
  type SprintScopeEvent,
} from "@/domain";
import { HEALTH_THRESHOLDS, sprintHealth, type HealthSignalId } from "@/metrics";

import { item, move, resetIds } from "./builders";

/**
 * The judgement on the sprint that is still running.
 *
 * Two things are being defended here, and they are not the arithmetic.
 *
 * The first is that **"non valutabile" never becomes "sereno"**. Every signal
 * has a case where it cannot be computed, and the tempting shortcut in each one
 * is to treat missing data as good news. A green light that means "I could not
 * look" is worse than no light, because it is believed.
 *
 * The second is that **the verdict is the worst finding and not an average**.
 * An average is how a dashboard reports a calm situation while one thing is on
 * fire, and it is the single most common way an indicator becomes decoration.
 */

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";
const SPRINT_ID = "2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35";
const BOARD_ID = "7a1c9e55-2b48-4f30-9d61-4e8a0c3f5b12";

const SCOPE = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  sourceSystem: "seed",
} as const;

const START = "2026-04-06T08:00:00.000Z";
const END = "2026-04-19T08:00:00.000Z";

/** Halfway through: the instant at which "half the work" is the expectation. */
const MIDPOINT = new Date("2026-04-12T20:00:00.000Z");

beforeEach(() => resetIds());

function sprint(overrides: Partial<{ id: string; startsAt: string; endsAt: string; completedAt: string | null }> = {}): Sprint {
  return sprintSchema.parse({
    id: overrides.id ?? SPRINT_ID,
    ...SCOPE,
    sourceId: `sprint-${overrides.id ?? SPRINT_ID}`,
    name: "Sprint in corso",
    goal: null,
    startsAt: overrides.startsAt ?? START,
    endsAt: overrides.endsAt ?? END,
    completedAt: overrides.completedAt ?? null,
    createdAt: START,
    updatedAt: START,
  });
}

let eventCounter = 0;

function added(workItemId: string, occurredAt: string = START, sprintId = SPRINT_ID): SprintScopeEvent {
  eventCounter += 1;

  return sprintScopeEventSchema.parse({
    ...SCOPE,
    sourceId: `scope-${eventCounter}`,
    sprintId,
    workItemId,
    kind: "added",
    reason: null,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

function column(state: BoardColumn["state"], wipLimit: number | null, position = 0): BoardColumn {
  return boardColumnSchema.parse({
    id: `00000000-0000-4000-9000-${String(position).padStart(12, "0")}`,
    ...SCOPE,
    sourceId: `column-${state}-${position}`,
    boardId: BOARD_ID,
    name: state,
    state,
    position,
    wipLimit,
    createdAt: START,
    updatedAt: START,
  });
}

function idOf(index: number): string {
  return `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/**
 * A sprint of `count` items, of which `doneCount` are finished.
 *
 * Everything starts on day one and the finished ones close on day two, so the
 * only variable a test changes is the one it is about.
 */
function evenSprint(count: number, doneCount: number) {
  const items = [];
  const transitions = [];
  const scopeEvents = [];

  for (let index = 0; index < count; index += 1) {
    const id = idOf(index);

    items.push(item({ id, sprintId: SPRINT_ID, estimate: { value: 1, unit: "points" } }));
    scopeEvents.push(added(id));
    transitions.push(move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: id }));

    if (index < doneCount) {
      transitions.push(move("in_progress", "done", "2026-04-07T09:00:00.000Z", { workItemId: id }));
    }
  }

  return { items, transitions, scopeEvents };
}

function health(overrides: Partial<Parameters<typeof sprintHealth>[0]> = {}) {
  const base = evenSprint(10, 5);

  return sprintHealth({
    sprint: sprint(),
    items: base.items,
    transitions: base.transitions,
    scopeEvents: base.scopeEvents,
    closedSprints: [],
    columns: [],
    asOf: MIDPOINT,
    ...overrides,
  });
}

function signalOf(result: ReturnType<typeof sprintHealth>, id: HealthSignalId) {
  if (!result.available) throw new Error(`giudizio non disponibile: ${result.reason}`);

  const signal = result.value.signals.find((candidate) => candidate.id === id);
  if (!signal) throw new Error(`segnale assente: ${id}`);

  return signal;
}

describe("soglie del giudizio", () => {
  it("hanno i valori dichiarati, e cambiarli fa fallire questo test", () => {
    /*
     * Il criterio 8 della specifica chiede che ogni soglia sia dichiarata in un
     * solo posto e che la sua modifica faccia fallire un test che la cita.
     *
     * Questo test non verifica un'aritmetica: verifica che nessuno sposti una
     * soglia in silenzio. Una soglia che si può cambiare senza doverla
     * argomentare ha smesso di essere una decisione.
     */
    expect(HEALTH_THRESHOLDS).toEqual({
      minimumElapsedFraction: 0.2,
      progressWatch: 0.7,
      progressCritical: 0.4,
      scopeAddedWatch: 0.15,
      scopeAddedCritical: 0.3,
      reviewWaitWatch: 1.5,
      reviewWaitCritical: 2.5,
      wipOverLimitWatch: 1,
      wipOverLimitCritical: 2,
      agingShareWatch: 0.15,
      agingShareCritical: 0.35,
      unownedShareWatch: 0.1,
      unownedShareCritical: 0.34,
    });
  });

  it("mette sempre la soglia critica oltre quella di attenzione", () => {
    // Invertirle produrrebbe un semaforo che non può mai diventare rosso, e
    // nessun test sui singoli segnali se ne accorgerebbe.
    expect(HEALTH_THRESHOLDS.progressCritical).toBeLessThan(HEALTH_THRESHOLDS.progressWatch);
    expect(HEALTH_THRESHOLDS.scopeAddedCritical).toBeGreaterThan(
      HEALTH_THRESHOLDS.scopeAddedWatch,
    );
    expect(HEALTH_THRESHOLDS.reviewWaitCritical).toBeGreaterThan(
      HEALTH_THRESHOLDS.reviewWaitWatch,
    );
    expect(HEALTH_THRESHOLDS.wipOverLimitCritical).toBeGreaterThan(
      HEALTH_THRESHOLDS.wipOverLimitWatch,
    );
    expect(HEALTH_THRESHOLDS.agingShareCritical).toBeGreaterThan(
      HEALTH_THRESHOLDS.agingShareWatch,
    );
  });
});

describe("quando il giudizio non si dà affatto", () => {
  it("non giudica uno sprint non ancora cominciato", () => {
    const result = health({ asOf: new Date("2026-04-01T09:00:00.000Z") });
    expect(result.available).toBe(false);
  });

  it("non giudica uno sprint già finito", () => {
    // Il semaforo riguarda ciò su cui si può ancora intervenire. Su uno sprint
    // chiuso la domanda giusta è un'altra, e ha già il suo resoconto.
    const result = health({ asOf: new Date("2026-04-25T09:00:00.000Z") });
    expect(result.available).toBe(false);
  });

  it("non finge una durata per uno sprint con date incoerenti", () => {
    const result = health({
      sprint: sprint({ startsAt: END, endsAt: START }),
    });

    expect(result.available).toBe(false);
  });

  it("si ferma al 100% il giorno in cui lo sprint finisce, non oltre", () => {
    const result = health({ asOf: new Date(END) });
    if (!result.available) throw new Error("atteso valutabile l'ultimo giorno");

    expect(result.value.elapsedFraction).toBe(1);
  });
});

describe("il verdetto è il peggiore, mai una media", () => {
  it("un solo segnale critico rende critico il giudizio", () => {
    /*
     * Il caso che giustifica la regola: quattro segnali sereni e uno grave.
     * Una media direbbe «va abbastanza bene», ed è esattamente il modo in cui
     * un indicatore diventa decorazione.
     */
    const base = evenSprint(10, 5);

    const result = sprintHealth({
      sprint: sprint(),
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
      closedSprints: [],
      // Dieci elementi in lavorazione contro un limite di due: oltre il doppio.
      columns: [column("in_progress", 2)],
      asOf: MIDPOINT,
    });

    if (!result.available) throw new Error("atteso disponibile");

    expect(signalOf(result, "wip-limit").status).toBe("critical");
    expect(result.value.verdict).toBe("critical");
  });

  it("senza alcun segnale valutabile dice «non valutabile», mai «sereno»", () => {
    // Uno sprint vuoto e appena aperto: nessuna delle cinque domande ha una
    // risposta. Il verde qui sarebbe la bugia più costosa dell'intera schermata.
    const result = sprintHealth({
      sprint: sprint(),
      items: [],
      transitions: [],
      scopeEvents: [],
      closedSprints: [],
      columns: [],
      asOf: MIDPOINT,
    });

    if (!result.available) throw new Error("atteso disponibile");

    expect(result.value.verdict).toBe("not-evaluable");
    for (const signal of result.value.signals) {
      expect(signal.status, `${signal.id} avrebbe dovuto essere non valutabile`).toBe(
        "not-evaluable",
      );
    }
  });

  it("un segnale non valutabile non abbassa un verdetto critico", () => {
    const base = evenSprint(10, 5);

    const result = sprintHealth({
      sprint: sprint(),
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
      closedSprints: [],
      columns: [column("in_progress", 2)],
      asOf: MIDPOINT,
    });

    if (!result.available) throw new Error("atteso disponibile");

    expect(signalOf(result, "review-wait").status).toBe("not-evaluable");
    expect(result.value.verdict).toBe("critical");
  });

  it("dà lo stesso risultato due volte sugli stessi dati", () => {
    // Criterio 10: ripetibile. Nessuna lettura dell'orologio, nessun caso in
    // cui l'ordine di iterazione cambi l'esito.
    const first = health();
    const second = health();

    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });
});

describe("avanzamento contro tempo trascorso", () => {
  it("non si pronuncia su uno sprint appena cominciato", () => {
    // Essere all'8% il primo giorno non significa nulla, e chiamarlo critico
    // insegnerebbe a ignorare il semaforo.
    const result = health({ asOf: new Date("2026-04-06T20:00:00.000Z") });

    expect(signalOf(result, "progress").status).toBe("not-evaluable");
    expect(signalOf(result, "progress").missing).toMatch(/appena cominciato/);
  });

  it("è sereno quando il lavoro concluso tiene il passo del calendario", () => {
    // Metà sprint, metà lavoro: esattamente il passo atteso.
    const result = health();
    expect(signalOf(result, "progress").status).toBe("respected");
  });

  it("diventa critico quando il lavoro concluso è molto indietro", () => {
    const base = evenSprint(10, 1);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
    });

    expect(signalOf(result, "progress").status).toBe("critical");
  });

  it("dichiara di quanto si discosta dalla soglia", () => {
    // Criterio 3: metrica, valore, soglia e scarto. «Sei indietro» invita a
    // un'alzata di spalle, «sei al 20% di dove dovresti» no.
    const base = evenSprint(10, 1);

    const signal = signalOf(
      health({
        items: base.items,
        transitions: base.transitions,
        scopeEvents: base.scopeEvents,
      }),
      "progress",
    );

    expect(signal.measured).not.toBeNull();
    expect(signal.threshold).toBe(HEALTH_THRESHOLDS.progressCritical);
    expect(signal.distance).toBeGreaterThan(0);
  });

  it("non è valutabile se le stime sono in unità diverse", () => {
    /*
     * Punti e ore non si sommano: una percentuale ricavata da quella somma
     * sarebbe una cifra inventata con l'aria di essere misurata.
     */
    const a = idOf(1);
    const b = idOf(2);

    const result = health({
      items: [
        item({ id: a, sprintId: SPRINT_ID, estimate: { value: 3, unit: "points" } }),
        item({ id: b, sprintId: SPRINT_ID, estimate: { value: 4, unit: "hours" } }),
      ],
      transitions: [
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: a }),
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: b }),
      ],
      scopeEvents: [added(a), added(b)],
    });

    expect(signalOf(result, "progress").status).toBe("not-evaluable");
    expect(signalOf(result, "progress").missing).toMatch(/unità diverse/);
  });

  it("misura sui conteggi quando nessun elemento è stimato", () => {
    // La tabella dei casi limite lo chiede esplicitamente: senza stime si
    // misura su quanti elementi, non si rinuncia.
    const a = idOf(1);
    const b = idOf(2);

    const result = health({
      items: [
        item({ id: a, sprintId: SPRINT_ID, estimate: null }),
        item({ id: b, sprintId: SPRINT_ID, estimate: null }),
      ],
      transitions: [
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: a }),
        move("in_progress", "done", "2026-04-07T09:00:00.000Z", { workItemId: a }),
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: b }),
      ],
      scopeEvents: [added(a), added(b)],
    });

    expect(signalOf(result, "progress").status).toBe("respected");
  });

  it("non è valutabile su uno sprint senza elementi", () => {
    const result = health({ items: [], transitions: [], scopeEvents: [] });
    expect(signalOf(result, "progress").status).toBe("not-evaluable");
  });
});

describe("lavoro aggiunto dopo l'inizio", () => {
  it("non conta come aggiunta ciò che c'era all'istante di inizio", () => {
    expect(signalOf(health(), "scope-added").measured).toBe(0);
    expect(signalOf(health(), "scope-added").status).toBe("respected");
  });

  it("si accende quando arriva troppo lavoro a sprint iniziato", () => {
    const base = evenSprint(10, 5);
    const extra = idOf(90);

    const result = health({
      items: [...base.items, item({ id: extra, sprintId: SPRINT_ID })],
      transitions: [
        ...base.transitions,
        move(null, "todo", "2026-04-09T09:00:00.000Z", { workItemId: extra }),
      ],
      scopeEvents: [
        ...base.scopeEvents,
        added(extra, "2026-04-09T09:00:00.000Z"),
        added(idOf(91), "2026-04-09T10:00:00.000Z"),
      ],
    });

    // Due aggiunte su dieci impegnati: oltre la soglia di attenzione.
    expect(signalOf(result, "scope-added").status).toBe("watch");
  });

  it("ignora ciò che entrerà dopo l'istante osservato", () => {
    const base = evenSprint(10, 5);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: [
        ...base.scopeEvents,
        added(idOf(90), "2026-04-18T09:00:00.000Z"),
        added(idOf(91), "2026-04-18T10:00:00.000Z"),
      ],
    });

    expect(signalOf(result, "scope-added").measured).toBe(0);
  });

  it("non è valutabile senza eventi di perimetro", () => {
    const base = evenSprint(10, 5);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: [],
    });

    expect(signalOf(result, "scope-added").status).toBe("not-evaluable");
  });
});

describe("limite di lavoro in corso", () => {
  it("non è valutabile quando nessuna colonna dichiara un limite", () => {
    // «Rispettato» qui affermerebbe che un limite esiste ed è onorato. Non
    // esiste, e inventarne uno significherebbe sostituire una scelta del team.
    const signal = signalOf(health({ columns: [column("in_progress", null)] }), "wip-limit");

    expect(signal.status).toBe("not-evaluable");
    expect(signal.missing).toMatch(/nessuna colonna dichiara un limite/);
  });

  it("è sereno quando la colonna sta entro il limite che il team si è dato", () => {
    const base = evenSprint(2, 0);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
      columns: [column("in_progress", 4)],
    });

    expect(signalOf(result, "wip-limit").status).toBe("respected");
  });

  it("prende il limite più stretto quando due colonne dichiarano lo stesso stato", () => {
    /*
     * Due colonne possono rappresentare lo stesso stato canonico. Prendere il
     * limite più largo ammorbidirebbe la promessa più forte che la squadra ha
     * fatto, ed è una scelta presa al posto suo.
     */
    const base = evenSprint(3, 0);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
      columns: [column("in_progress", 8, 0), column("in_progress", 2, 1)],
    });

    expect(signalOf(result, "wip-limit").status).not.toBe("respected");
  });
});

describe("attesa in revisione contro l'abitudine del team", () => {
  it("non è valutabile con meno di due sprint conclusi", () => {
    // Uno sprint solo è un caso, non un'abitudine: «più lento del solito» non
    // ha un solito.
    const signal = signalOf(health({ closedSprints: [sprint({ id: idOf(70) })] }), "review-wait");

    expect(signal.status).toBe("not-evaluable");
    expect(signal.missing).toMatch(/due sprint conclusi/);
  });

  it("si accende quando la revisione di questo sprint è più lenta del solito", () => {
    const previousA = "3d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c901";
    const previousB = "3d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c902";

    const old = idOf(50);
    const current = idOf(51);

    const result = health({
      items: [
        item({ id: old, sprintId: previousA }),
        item({ id: current, sprintId: SPRINT_ID }),
      ],
      transitions: [
        // Una revisione storica di un'ora.
        move(null, "in_review", "2026-03-02T09:00:00.000Z", { workItemId: old }),
        move("in_review", "done", "2026-03-02T10:00:00.000Z", { workItemId: old }),
        // Una revisione aperta da giorni.
        move(null, "in_review", "2026-04-08T09:00:00.000Z", { workItemId: current }),
      ],
      scopeEvents: [added(current)],
      closedSprints: [
        sprint({ id: previousA, completedAt: "2026-03-20T17:00:00.000Z" }),
        sprint({ id: previousB, completedAt: "2026-03-30T17:00:00.000Z" }),
      ],
    });

    expect(signalOf(result, "review-wait").status).toBe("critical");
  });
});

describe("elementi fermi", () => {
  it("non è valutabile finché il progetto non ha concluso nulla", () => {
    // Senza storia non si sa quanto ci mette di solito un elemento, e senza
    // quello «fermo da troppo» non ha un troppo.
    const base = evenSprint(3, 0);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
    });

    expect(signalOf(result, "aging").status).toBe("not-evaluable");
  });

  it("si accende quando molti elementi aperti superano l'abitudine del progetto", () => {
    const quick = idOf(60);
    const stuckA = idOf(61);
    const stuckB = idOf(62);

    const result = health({
      items: [
        item({ id: quick, sprintId: SPRINT_ID }),
        item({ id: stuckA, sprintId: SPRINT_ID }),
        item({ id: stuckB, sprintId: SPRINT_ID }),
      ],
      transitions: [
        // Un elemento concluso in un'ora: è l'abitudine del progetto.
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: quick }),
        move("in_progress", "done", "2026-04-06T10:00:00.000Z", { workItemId: quick }),
        // Due aperti da giorni.
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: stuckA }),
        move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: stuckB }),
      ],
      scopeEvents: [added(quick), added(stuckA), added(stuckB)],
    });

    expect(signalOf(result, "aging").status).toBe("critical");
  });

  it("non è valutabile quando lo sprint non ha elementi aperti", () => {
    const base = evenSprint(3, 3);

    const result = health({
      items: base.items,
      transitions: base.transitions,
      scopeEvents: base.scopeEvents,
    });

    expect(signalOf(result, "aging").status).toBe("not-evaluable");
  });
});

describe("lavoro che nessuno ha in carico", () => {
  const SOMEBODY = "11111111-0000-4000-8000-00000000000a";

  /**
   * A sprint where `unownedCount` of the items in progress are held by nobody.
   *
   * At least one item is always assigned, because a project that never fills
   * in the field is a different situation — the one the next test is about.
   */
  function boardWith(unownedCount: number, total: number) {
    const items = [];
    const transitions = [];
    const scopeEvents = [];

    for (let index = 0; index < total; index += 1) {
      const id = idOf(index);

      items.push(
        item({
          id,
          sprintId: SPRINT_ID,
          estimate: { value: 1, unit: "points" },
          assigneeId: index < unownedCount ? null : SOMEBODY,
        }),
      );
      scopeEvents.push(added(id));
      transitions.push(move(null, "in_progress", "2026-04-06T09:00:00.000Z", { workItemId: id }));
    }

    return { items, transitions, scopeEvents };
  }

  it("è sereno quando quasi tutto il lavoro ha un titolare", () => {
    const signal = signalOf(health(boardWith(0, 10)), "unowned");
    expect(signal.status).toBe("respected");
  });

  it("diventa critico quando un terzo della lavagna non è in carico a nessuno", () => {
    const signal = signalOf(health(boardWith(4, 10)), "unowned");
    expect(signal.status).toBe("critical");
    expect(signal.measured).toBe(0.4);
  });

  it("non si pronuncia se il progetto non registra chi prende in carico", () => {
    /*
     * La distinzione che rende il segnale utilizzabile.
     *
     * `evenSprint` non assegna nessuno: senza questo caso il segnale sarebbe
     * rosso fisso su ogni progetto che non usa il campo, cioè un allarme che
     * non dipende da come sta andando lo sprint.
     */
    const signal = signalOf(health(), "unowned");
    expect(signal.status).toBe("not-evaluable");
    expect(signal.missing).not.toBeNull();
  });

  it("non nomina chi ha in carico gli altri elementi", () => {
    // §8.2 di nuovo, ma sul segnale che ci va più vicino di tutti: qui un
    // identificativo di persona sarebbe a portata di mano e non deve esserci.
    const result = health(boardWith(4, 10));
    if (!result.available) throw new Error("atteso disponibile");

    expect(JSON.stringify(result.value)).not.toContain(SOMEBODY);
  });
});

describe("nessun segnale riguarda una persona", () => {
  it("il giudizio non espone alcun identificativo di persona", () => {
    /*
     * §8.2: si misura il processo. Il modo naturale di «spiegare» un semaforo
     * rosso è dire chi ha in mano gli elementi fermi, ed è esattamente ciò che
     * questo prodotto si vieta di produrre.
     *
     * La verifica è sulla forma del risultato, non sulle intenzioni: se un
     * campo con un nome o un identificativo comparisse qui, questo test
     * cadrebbe.
     */
    const result = health();
    if (!result.available) throw new Error("atteso disponibile");

    const serialised = JSON.stringify(result.value);

    expect(serialised).not.toMatch(/assignee/i);
    expect(serialised).not.toMatch(/person/i);
    expect(serialised).not.toMatch(/actor/i);
  });
});
