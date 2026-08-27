import { beforeEach, describe, expect, it } from "vitest";

import { type SprintScopeEvent, sprintScopeEventSchema, sprintSchema } from "@/domain";
import { demoAgenda, demoChecklist } from "@/metrics";

import { item, move, resetIds } from "./builders";

/**
 * La demo di sprint del capitolo 9.
 *
 * I test raccontano le due decisioni che il libro prende su una demo — che cosa
 * si mostra e che cosa si nomina soltanto — e il caso che il dialogo su
 * «indemonstrable stuff» mette a fuoco: una storia finita di cui nessuno ha
 * scritto come si dimostra.
 */

const SCOPE = {
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
} as const;

const SPRINT_ID = "5c9e7b21-3f4a-4d68-9b17-2e8c6a0f4d33";

const STORY = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_STORY = "aaaaaaaa-0000-4000-8000-000000000002";
const BUG = "aaaaaaaa-0000-4000-8000-000000000003";
const TASK = "aaaaaaaa-0000-4000-8000-000000000004";

const START = "2026-04-06T08:00:00.000Z";
const END = "2026-04-17T17:00:00.000Z";

let eventCounter = 0;

function sprint(goal: string | null = "Chiudere il checkout") {
  return sprintSchema.parse({
    id: SPRINT_ID,
    ...SCOPE,
    sourceSystem: "seed",
    sourceId: "sprint-1",
    name: "Sprint 1",
    goal,
    startsAt: START,
    endsAt: END,
    completedAt: END,
    createdAt: START,
    updatedAt: START,
  });
}

function scopeEvent(
  workItemId: string,
  kind: "added" | "removed",
  occurredAt: string,
): SprintScopeEvent {
  eventCounter += 1;

  return sprintScopeEventSchema.parse({
    ...SCOPE,
    sourceSystem: "seed",
    sourceId: `scope-${eventCounter}`,
    sprintId: SPRINT_ID,
    workItemId,
    kind,
    reason: null,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

/** A finished story, with its arrival in the sprint and its move to done. */
function finished(id: string, overrides: Parameters<typeof item>[0] = {}) {
  return {
    item: item({ id, ...overrides }),
    scope: scopeEvent(id, "added", START),
    transition: move("in_progress", "done", "2026-04-15T10:00:00.000Z", { workItemId: id }),
  };
}

describe("demoAgenda", () => {
  beforeEach(() => {
    resetIds();
    eventCounter = 0;
  });

  it("mette in scaletta le storie finite, in ordine di backlog", () => {
    const first = finished(STORY, { title: "Pagamento con carta", backlogOrder: 20 });
    const second = finished(OTHER_STORY, { title: "Cronologia ordini", backlogOrder: 10 });

    const agenda = demoAgenda({
      sprint: sprint(),
      items: [first.item, second.item],
      transitions: [first.transition, second.transition],
      scopeEvents: [first.scope, second.scope],
    });

    expect(agenda.toDemo.map((entry) => entry.title)).toEqual([
      "Cronologia ordini",
      "Pagamento con carta",
    ]);
  });

  it("nomina soltanto correzioni e task, invece di dimostrarli", () => {
    // «Don't demonstrate a bunch of minor bug fixes and trivial features.
    // Mention them but don't demo them.» (pag. 82)
    const story = finished(STORY, { title: "Pagamento con carta" });
    const bug = finished(BUG, { kind: "bug", title: "Totale arrotondato male" });
    const task = finished(TASK, { kind: "task", title: "Aggiornare la libreria" });

    const agenda = demoAgenda({
      sprint: sprint(),
      items: [story.item, bug.item, task.item],
      transitions: [story.transition, bug.transition, task.transition],
      scopeEvents: [story.scope, bug.scope, task.scope],
    });

    expect(agenda.toDemo.map((entry) => entry.title)).toEqual(["Pagamento con carta"]);
    expect(agenda.toMention.map((entry) => entry.title)).toEqual([
      "Totale arrotondato male",
      "Aggiornare la libreria",
    ]);
  });

  it("uno sprint di sole correzioni non produce nulla da mostrare", () => {
    const bug = finished(BUG, { kind: "bug", title: "Totale arrotondato male" });

    const agenda = demoAgenda({
      sprint: sprint(),
      items: [bug.item],
      transitions: [bug.transition],
      scopeEvents: [bug.scope],
    });

    expect(agenda.toDemo).toEqual([]);
    expect(agenda.toMention).toHaveLength(1);
  });

  it("una storia riaperta prima della chiusura non entra in scaletta", () => {
    // La stessa regola della velocity: alla chiusura non era finita.
    const story = finished(STORY);
    const reopened = move("done", "in_progress", "2026-04-16T09:00:00.000Z", {
      workItemId: STORY,
    });

    const agenda = demoAgenda({
      sprint: sprint(),
      items: [story.item],
      transitions: [story.transition, reopened],
      scopeEvents: [story.scope],
    });

    expect(agenda.toDemo).toEqual([]);
  });

  it("un elemento tolto dallo sprint non entra in scaletta", () => {
    const story = finished(STORY);
    const removed = scopeEvent(STORY, "removed", "2026-04-14T09:00:00.000Z");

    const agenda = demoAgenda({
      sprint: sprint(),
      items: [story.item],
      transitions: [story.transition],
      scopeEvents: [story.scope, removed],
    });

    expect(agenda.toDemo).toEqual([]);
    expect(agenda.toMention).toEqual([]);
  });

  it("una storia senza «come si dimostra» viene segnalata", () => {
    const written = finished(STORY, {
      title: "Pagamento con carta",
      howToDemo: "Aggiungi due articoli e paga con una carta di prova.",
      backlogOrder: 10,
    });
    const silent = finished(OTHER_STORY, { title: "Cronologia ordini", backlogOrder: 20 });

    const agenda = demoAgenda({
      sprint: sprint(),
      items: [written.item, silent.item],
      transitions: [written.transition, silent.transition],
      scopeEvents: [written.scope, silent.scope],
    });

    expect(agenda.toDemo).toHaveLength(2);
    expect(agenda.withoutHowToDemo.map((entry) => entry.title)).toEqual(["Cronologia ordini"]);
  });

  it("riporta l'obiettivo dello sprint, che il libro chiede di presentare per primo", () => {
    const agenda = demoAgenda({
      sprint: sprint(),
      items: [],
      transitions: [],
      scopeEvents: [],
    });

    expect(agenda.goal).toBe("Chiudere il checkout");
  });

  it("uno sprint senza elementi finiti produce due elenchi vuoti", () => {
    // Vuoto è un'informazione: non c'è nulla da mostrare, e va detto.
    const agenda = demoAgenda({
      sprint: sprint(),
      items: [item({ id: STORY })],
      transitions: [],
      scopeEvents: [scopeEvent(STORY, "added", START)],
    });

    expect(agenda.toDemo).toEqual([]);
    expect(agenda.toMention).toEqual([]);
  });
});

describe("demoChecklist", () => {
  beforeEach(() => {
    resetIds();
    eventCounter = 0;
  });

  const build = (goal: string | null, parts: readonly ReturnType<typeof finished>[]) =>
    demoChecklist({
      sprint: sprint(goal),
      items: parts.map((part) => part.item),
      transitions: parts.map((part) => part.transition),
      scopeEvents: parts.map((part) => part.scope),
    });

  it("riporta le sei regole del libro più il controllo sul «come si dimostra»", () => {
    expect(build("Chiudere il checkout", [])).toHaveLength(7);
  });

  it("ogni voce dice anche perché, non solo se", () => {
    for (const entry of build("Chiudere il checkout", [])) {
      expect(entry.detail.length, `la voce «${entry.id}» non spiega nulla`).toBeGreaterThan(0);
    }
  });

  it("senza obiettivo la prima voce risulta da fare", () => {
    const entries = build(null, []);

    expect(entries.find((entry) => entry.id === "goal")?.status).toBe("todo");
  });

  it("con l'obiettivo scritto la prima voce è fatta, e lo mostra", () => {
    const entries = build("Chiudere il checkout", []);
    const goal = entries.find((entry) => entry.id === "goal");

    expect(goal?.status).toBe("done");
    expect(goal?.detail).toBe("Chiudere il checkout");
  });

  it("senza elementi minori la regola sulle correzioni non si applica", () => {
    // «Non ancora», non «fatta»: non c'è nulla su cui la regola si applichi, e
    // spuntarla direbbe che una decisione è stata presa quando non c'era da
    // prenderne alcuna.
    const entries = build("Chiudere il checkout", [finished(STORY)]);

    expect(entries.find((entry) => entry.id === "minor-fixes")?.status).toBe("not-yet");
  });

  it("con correzioni finite la scaletta è già divisa, e la voce risulta fatta", () => {
    const entries = build("Chiudere il checkout", [
      finished(STORY),
      finished(BUG, { kind: "bug" }),
    ]);

    expect(entries.find((entry) => entry.id === "minor-fixes")?.status).toBe("done");
  });

  it("lascia umane le quattro regole sul modo di condurre la demo", () => {
    // Non sono un limite del portale: «keep a high pace» è un consiglio a una
    // persona in una stanza, e nessun database lo verifica.
    const human = build("Chiudere il checkout", []).filter((entry) => entry.status === "human");

    expect(human.map((entry) => entry.id)).toEqual([
      "preparation",
      "pace",
      "business-level",
      "hands-on",
    ]);
  });

  it("segnala le storie in scaletta senza «come si dimostra»", () => {
    const entries = build("Chiudere il checkout", [finished(STORY)]);

    expect(entries.find((entry) => entry.id === "how-to-demo")?.status).toBe("todo");
  });

  it("è soddisfatta quando ogni storia in scaletta dice come si dimostra", () => {
    const entries = build("Chiudere il checkout", [
      finished(STORY, { howToDemo: "Aggiungi due articoli e paga con una carta di prova." }),
    ]);

    expect(entries.find((entry) => entry.id === "how-to-demo")?.status).toBe("done");
  });
});
