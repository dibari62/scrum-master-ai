import { describe, expect, it } from "vitest";

import { seedConnector, generateSeedBatch } from "@/connectors/seed";
import { ITEM_TITLES } from "@/connectors/seed/scenario";
import { isMidSprintAddition, organizationIdSchema, projectIdSchema } from "@/domain";

import { runConnectorConformance } from "./conformance";

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

/**
 * The instant the data set is generated at.
 *
 * Fixed, never `new Date()`. The scenario now places its sprints backwards from
 * this instant so the last one is always in flight — which means a test that
 * passed the current time would assert against a different data set every day,
 * and would eventually fail on a date nobody chose.
 *
 * A Wednesday at mid-morning: a weekday, so the Monday alignment has to do some
 * work rather than landing on itself.
 */
const ASOF = new Date("2026-08-19T10:00:00.000Z");

describe("connettore seed — conformità", () => {
  runConnectorConformance({
    connector: seedConnector,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
  });
});

describe("connettore seed — determinismo", () => {
  it("lo stesso seme produce gli stessi dati", () => {
    const first = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 42,
      asOf: ASOF,
      });
    const second = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 42,
      asOf: ASOF,
      });

    // Gli identificativi interni sono generati a ogni chiamata, quindi il
    // confronto è sui dati osservabili: titoli, stime, stati e istanti.
    expect(second.workItems.map((i) => [i.sourceId, i.title, i.state, i.estimate])).toEqual(
      first.workItems.map((i) => [i.sourceId, i.title, i.state, i.estimate]),
    );
    expect(second.transitions.map((t) => [t.sourceId, t.toState, t.occurredAt])).toEqual(
      first.transitions.map((t) => [t.sourceId, t.toState, t.occurredAt]),
    );
  });

  it("semi diversi producono storie diverse", () => {
    const a = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 1,
      asOf: ASOF,
      });
    const b = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 2,
      asOf: ASOF,
      });

    expect(b.transitions.map((t) => t.occurredAt.toISOString())).not.toEqual(
      a.transitions.map((t) => t.occurredAt.toISOString()),
    );
  });
});

/**
 * The data set both suites below read.
 *
 * Generated once at module scope rather than inside each `describe`: two
 * generations at the same instant are identical, so a second one would only
 * cost time — and having a single named batch is what lets the anomaly checks
 * and the truncation checks talk about the *same* story.
 */
const batch = generateSeedBatch({
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  asOf: ASOF,
});

const sprints = [...batch.sprints].sort(
  (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
);

/**
 * Le anomalie sono il motivo per cui questo insieme di dati esiste.
 *
 * Un dataset che mostra una squadra sana non dimostrerebbe nulla: il prodotto
 * serve ad accorgersi dei problemi, quindi i dati devono contenerne. Questi
 * test verificano che ci siano davvero — altrimenti a T2 la dashboard
 * mostrerebbe quattro sprint identici e perfetti.
 */
describe("connettore seed — anomalie volute", () => {
  it("genera quattro sprint, con l'ultimo ancora aperto", () => {
    expect(sprints).toHaveLength(4);
    expect(sprints.at(-1)?.completedAt).toBeNull();
    for (const sprint of sprints.slice(0, -1)) {
      expect(sprint.completedAt).not.toBeNull();
    }
  });

  it("contiene lavoro aggiunto a sprint iniziato", () => {
    const midSprint = batch.scopeEvents.filter((event) => {
      const sprint = sprints.find((s) => s.id === event.sprintId);
      return sprint ? isMidSprintAddition(event, sprint) : false;
    });

    expect(midSprint.length).toBeGreaterThan(0);
  });

  it("il collo di bottiglia in revisione peggiora nel tempo", () => {
    // Confronta l'attesa media in revisione del primo sprint con quella
    // dell'ultimo: è il segnale che la dashboard dovrà rendere visibile.
    const waitFor = (sprintIndex: number): number => {
      const sprint = sprints[sprintIndex];
      if (!sprint) return 0;

      const items = new Set(
        batch.workItems.filter((i) => i.sprintId === sprint.id).map((i) => i.id),
      );
      const waits = batch.pullRequests
        .filter((pr) => pr.workItemId !== null && items.has(pr.workItemId))
        .filter((pr) => pr.firstReviewAt !== null)
        .map((pr) => (pr.firstReviewAt as Date).getTime() - pr.openedAt.getTime());

      return waits.length === 0 ? 0 : waits.reduce((a, b) => a + b, 0) / waits.length;
    };

    expect(waitFor(3)).toBeGreaterThan(waitFor(0));
  });

  it("contiene elementi rimasti bloccati", () => {
    const blocked = batch.transitions.filter((t) => t.toState === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    expect(batch.impediments.length).toBeGreaterThan(0);
  });

  it("contiene elementi riaperti dopo essere stati conclusi", () => {
    const reopened = batch.transitions.filter((t) => t.fromState === "done");
    expect(reopened.length).toBeGreaterThan(0);
  });

  it("contiene lavoro trascinato da uno sprint al successivo", () => {
    // Lo stesso elemento che compare in due sprint: prima rimosso dall'uno,
    // poi aggiunto all'altro.
    const removals = batch.scopeEvents.filter((e) => e.kind === "removed");
    expect(removals.length).toBeGreaterThan(0);
  });

  it("usa solo persone e indirizzi fittizi", () => {
    // AGENTS.md §8.2: mai dati reali di colleghi o clienti. Il dominio
    // example.invalid è riservato e non può raggiungere nessuna casella.
    for (const person of batch.people) {
      expect(person.email).toMatch(/@example\.invalid$/);
    }
  });

  it("non dà lo stesso titolo a due elementi diversi", () => {
    /*
     * Il generatore percorre `ITEM_TITLES` e riparte da capo quando la
     * esaurisce. Con diciotto titoli e cinquantun elementi ogni titolo
     * ricompariva tre volte, e la pagina degli elementi mostrava la stessa
     * riga più volte: dati distinti che *sembrano* duplicati.
     *
     * Le righe erano sempre state diverse — sprint diverso, storia diversa,
     * identificativo diverso — ma dei dati di dimostrazione che sembrano rotti
     * costano quanto dei dati rotti.
     */
    const titles = batch.workItems.map((item) => item.title);
    const repeated = titles.filter((title, index) => titles.indexOf(title) !== index);

    expect(
      [...new Set(repeated)],
      `titoli usati per più di un elemento: ${[...new Set(repeated)].join(", ")}`,
    ).toEqual([]);
  });

  it("ha più titoli disponibili di quanti elementi generi", () => {
    // La condizione che rende vero il test precedente. Detta a parte perché,
    // quando fallirà, dirà *perché*: la lista è diventata troppo corta.
    expect(ITEM_TITLES.length).toBeGreaterThanOrEqual(batch.workItems.length);
  });
});

/**
 * Lo scenario è ancorato all'istante in cui viene letto (questione Q5).
 *
 * Serviva uno sprint in corso: senza, il giudizio sulla salute dello sprint
 * poteva solo rispondere «non ce n'è uno». Ma uno sprint a metà non ha una
 * storia intera, e la parte difficile della decisione è tutta qui — se il
 * generatore scrivesse comunque i quattordici giorni, il database conterrebbe
 * elementi conclusi **domani**.
 *
 * Sarebbe un difetto peggiore di quello risolto, perché invisibile: ogni
 * singolo numero resterebbe plausibile, e solo chi pensasse a confrontare una
 * data con oggi si accorgerebbe che i dati raccontano cose non avvenute.
 */
describe("connettore seed — ancorato all'istante di lettura", () => {
  it("colloca l'ultimo sprint a cavallo dell'istante, non nel passato", () => {
    const last = sprints.at(-1);
    if (!last) throw new Error("atteso almeno uno sprint");

    expect(last.startsAt.getTime()).toBeLessThanOrEqual(ASOF.getTime());
    expect(last.endsAt.getTime()).toBeGreaterThanOrEqual(ASOF.getTime());
    expect(last.completedAt).toBeNull();
  });

  it("lascia lo sprint in corso abbastanza avanti da poterlo giudicare", () => {
    /*
     * Uno sprint iniziato ieri non si può giudicare: essere all'8% il primo
     * giorno non significa nulla. L'ancoraggio garantisce che l'istante cada
     * ben dentro l'ultimo sprint, altrimenti la funzione sarebbe dimostrabile
     * solo nei giorni fortunati.
     */
    const last = sprints.at(-1);
    if (!last) throw new Error("atteso almeno uno sprint");

    const elapsed = ASOF.getTime() - last.startsAt.getTime();
    const span = last.endsAt.getTime() - last.startsAt.getTime();

    expect(elapsed / span).toBeGreaterThan(0.4);
    expect(elapsed / span).toBeLessThanOrEqual(1);
  });

  it("gli sprint precedenti restano chiusi e in ordine, senza sovrapporsi", () => {
    for (const [index, sprint] of sprints.entries()) {
      const next = sprints[index + 1];
      if (!next) continue;

      expect(sprint.endsAt.getTime()).toBeLessThan(next.startsAt.getTime());
    }
  });

  it("non produce nulla datato dopo l'istante di lettura", () => {
    /*
     * Il controllo che tiene in piedi la decisione.
     *
     * Cammina su **ogni record e ogni campo di data**, ricavando i campi
     * dall'oggetto invece di elencarli: una regola di questa forma non si
     * rompe modificando un campo esistente, si rompe aggiungendone uno nuovo a
     * cui nessuno ha ripensato. Elencarli qui a mano avrebbe significato
     * scoprire l'omissione guardando una schermata.
     */
    const groups: ReadonlyArray<readonly [string, ReadonlyArray<object>]> = [
      ["persone", batch.people],
      ["board", batch.boards],
      ["colonne", batch.boardColumns],
      ["elementi", batch.workItems],
      ["transizioni", batch.transitions],
      ["eventi di perimetro", batch.scopeEvents],
      ["commenti", batch.comments],
      ["impedimenti", batch.impediments],
      ["pull request", batch.pullRequests],
    ];

    const future: string[] = [];

    for (const [label, records] of groups) {
      for (const record of records) {
        for (const [field, value] of Object.entries(record)) {
          if (!(value instanceof Date)) continue;
          if (value.getTime() <= ASOF.getTime()) continue;

          future.push(`${label}.${field} = ${value.toISOString()}`);
        }
      }
    }

    expect(
      [...new Set(future)].slice(0, 5),
      `campi datati nel futuro: ${future.length}`,
    ).toEqual([]);
  });

  it("lo stato di un elemento è quello che la storia rimasta gli assegna", () => {
    /*
     * Il taglio rimuove le transizioni future, e `state` è un riassunto della
     * storia: senza ricalcolarlo resterebbe un elemento marcato «concluso» la
     * cui conclusione è stata rimossa. È il difetto che il taglio poteva
     * introdurre risolvendone un altro.
     */
    const wrong: string[] = [];

    for (const item of batch.workItems) {
      const history = batch.transitions
        .filter((transition) => transition.workItemId === item.id)
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

      const last = history.at(-1);
      const expected = last?.toState ?? "todo";

      if (item.state !== expected) {
        wrong.push(`${item.sourceId}: dichiara ${item.state}, la storia dice ${expected}`);
      }
    }

    expect(wrong.slice(0, 5), `elementi incoerenti: ${wrong.length}`).toEqual([]);
  });

  it("un impedimento risolto oltre l'istante risulta ancora aperto", () => {
    // Sollevato prima, risolto dopo: al momento del taglio è aperto, ed è la
    // sola lettura onesta di quel record. Dichiararlo risolto significherebbe
    // affermare che qualcosa è già accaduto.
    for (const impediment of batch.impediments) {
      if (impediment.resolvedAt === null) continue;

      expect(impediment.resolvedAt.getTime()).toBeLessThanOrEqual(ASOF.getTime());
      expect(impediment.resolvedAt.getTime()).toBeGreaterThanOrEqual(
        impediment.raisedAt.getTime(),
      );
    }
  });

  it("due istanti diversi producono due storie diverse, entrambe coerenti", () => {
    // L'ancoraggio non è cosmetico: se i dati non si spostassero con
    // l'istante, l'ultimo sprint tornerebbe a essere sempre lo stesso e la
    // schermata da dimostrare resterebbe vuota.
    const later = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      asOf: new Date("2026-11-18T10:00:00.000Z"),
    });

    const before = sprints.at(-1);
    const after = [...later.sprints].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    ).at(-1);

    expect(after?.startsAt.getTime()).toBeGreaterThan(before?.startsAt.getTime() ?? 0);
  });
});
