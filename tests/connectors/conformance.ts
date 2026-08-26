import { expect, it } from "vitest";

import {
  findHistoryDefects,
  groupEstimateChanges,
  isTerminalState,
  type StateTransition,
} from "@/domain";

import { allRecords, type CanonicalBatch, type Connector } from "@/connectors/contract";

/**
 * The suite every connector must pass.
 *
 * Written once and run against each connector, so a new integration inherits
 * the same guarantees instead of relying on whoever wrote it having remembered
 * them. `seed` is the reference implementation.
 *
 * It lives under `tests/` rather than `src/` because it imports the test
 * runner: shipping that import inside production code would drag vitest into
 * the application bundle.
 *
 * It checks properties, not values: a connector is free to produce any history
 * it likes, provided the history is coherent, attributable and reconcilable.
 */

type ConformanceOptions = {
  readonly connector: Connector;
  readonly organizationId: string;
  readonly projectId: string;
};

/** Groups transitions by the item they belong to. */
function historiesByItem(
  transitions: readonly StateTransition[],
): ReadonlyMap<string, StateTransition[]> {
  const histories = new Map<string, StateTransition[]>();

  for (const transition of transitions) {
    const existing = histories.get(transition.workItemId);
    if (existing) existing.push(transition);
    else histories.set(transition.workItemId, [transition]);
  }

  return histories;
}

export function runConnectorConformance(options: ConformanceOptions): void {
  /**
   * The instant every fetch in this suite happens at.
   *
   * Fixed rather than `new Date()`: a conformance suite that moves with the
   * clock passes or fails depending on the day it runs, which is the opposite
   * of what it is for. A Wednesday, so the Monday alignment of a generated
   * scenario has something to move.
   */
  const ASOF = new Date("2026-08-19T10:00:00.000Z");

  const fetchBatch = (since?: Date): Promise<CanonicalBatch> =>
    options.connector.fetch({
      organizationId: options.organizationId as never,
      projectId: options.projectId as never,
      since,
      asOf: ASOF,
    });

  it("dichiara il proprio sistema di origine su ogni record", async () => {
    const batch = await fetchBatch();

    for (const record of allRecords(batch)) {
      expect(record.sourceSystem).toBe(options.connector.system);
      expect(record.sourceId.length).toBeGreaterThan(0);
    }
  });

  it("non riusa lo stesso sourceId per due record dello stesso tipo", async () => {
    // La chiave di riconciliazione è (organizzazione, sistema, sourceId): se
    // due record la condividono, la seconda ingestione ne sovrascrive uno.
    const batch = await fetchBatch();

    const groups: ReadonlyArray<readonly [string, ReadonlyArray<{ sourceId: string }>]> = [
      ["persone", batch.people],
      ["board", batch.boards],
      ["colonne", batch.boardColumns],
      ["sprint", batch.sprints],
      ["elementi", batch.workItems],
      ["transizioni", batch.transitions],
      ["variazioni di perimetro", batch.scopeEvents],
      ["commenti", batch.comments],
      ["impedimenti", batch.impediments],
      ["pull request", batch.pullRequests],
    ];

    for (const [label, records] of groups) {
      const ids = records.map((record) => record.sourceId);
      expect(new Set(ids).size, `sourceId duplicati fra ${label}`).toBe(ids.length);
    }
  });

  it("è idempotente: due ingestioni identiche producono gli stessi sourceId", async () => {
    const [first, second] = await Promise.all([fetchBatch(), fetchBatch()]);

    expect(allRecords(second).map((r) => r.sourceId)).toEqual(
      allRecords(first).map((r) => r.sourceId),
    );
  });

  it("popola la storia degli stati, non solo lo stato corrente", async () => {
    const batch = await fetchBatch();

    expect(batch.workItems.length).toBeGreaterThan(0);
    expect(batch.transitions.length).toBeGreaterThan(batch.workItems.length);

    // Ogni elemento deve avere una storia: senza, quasi nessuna metrica di
    // flusso è calcolabile (ADR-0003).
    const histories = historiesByItem(batch.transitions);
    for (const item of batch.workItems) {
      expect(histories.get(item.id), `nessuna transizione per ${item.sourceId}`).toBeDefined();
    }
  });

  it("produce storie coerenti", async () => {
    const batch = await fetchBatch();

    for (const [itemId, transitions] of historiesByItem(batch.transitions)) {
      expect(findHistoryDefects(transitions), `storia incoerente per ${itemId}`).toEqual([]);
    }
  });

  it("lo stato corrente coincide con l'ultima transizione", async () => {
    // Uno stato che non deriva dalla storia significa che una delle due fonti
    // mente, e non c'è modo di sapere quale.
    const batch = await fetchBatch();
    const histories = historiesByItem(batch.transitions);

    for (const item of batch.workItems) {
      const history = [...(histories.get(item.id) ?? [])].sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
      const last = history[history.length - 1];

      expect(last?.toState, `stato incoerente per ${item.sourceId}`).toBe(item.state);
    }
  });

  it("popola la storia delle stime, non solo la stima corrente", async () => {
    /*
     * Stessa ragione della storia degli stati (ADR-0003, ADR-0008): la velocity
     * conta la stima che un elemento aveva **all'ingresso** nello sprint, e con
     * il solo valore corrente quella cifra è irrecuperabile.
     *
     * Una fonte che espone solo il valore di adesso emette **una** variazione
     * all'istante di creazione. È una risposta completa a ciò che può
     * osservare, non un ripiego: ogni elemento ha una storia, anche se lunga
     * uno.
     */
    const batch = await fetchBatch();
    const byItem = groupEstimateChanges(batch.estimateChanges);

    for (const item of batch.workItems) {
      expect(
        byItem.get(item.id),
        `nessuna variazione di stima per ${item.sourceId}`,
      ).toBeDefined();
    }
  });

  it("la stima corrente coincide con l'ultima variazione", async () => {
    // Se le due fonti divergono, una delle due mente e non c'è modo di sapere
    // quale — lo stesso argomento applicato allo stato qui sopra.
    const batch = await fetchBatch();
    const byItem = groupEstimateChanges(batch.estimateChanges);

    for (const item of batch.workItems) {
      const history = byItem.get(item.id) ?? [];
      const last = history[history.length - 1];

      expect(last?.toEstimate ?? null, `stima incoerente per ${item.sourceId}`).toEqual(
        item.estimate,
      );
    }
  });

  it("ogni variazione di stima riparte da dove la precedente si era fermata", async () => {
    // Una catena spezzata — «da 5» su un elemento che valeva 8 — produce una
    // velocity plausibile e sbagliata, che è la classe di difetto peggiore.
    const batch = await fetchBatch();

    for (const [itemId, changes] of groupEstimateChanges(batch.estimateChanges)) {
      let previous = null;

      for (const [index, change] of changes.entries()) {
        expect(
          change.fromEstimate,
          `variazione ${index} di ${itemId}: parte da un valore che l'elemento non aveva`,
        ).toEqual(previous);

        previous = change.toEstimate;
      }
    }
  });

  it("non colloca una variazione di stima prima della creazione dell'elemento", async () => {
    const batch = await fetchBatch();
    const items = new Map(batch.workItems.map((item) => [item.id, item]));

    for (const change of batch.estimateChanges) {
      const item = items.get(change.workItemId);
      if (!item) continue;

      expect(
        change.occurredAt.getTime(),
        `stima anteriore alla creazione di ${item.sourceId}`,
      ).toBeGreaterThanOrEqual(item.sourceCreatedAt.getTime());
    }
  });

  it("ogni previsione punta a uno sprint del lotto", async () => {
    /*
     * Una previsione è facoltativa — quasi nessuno strumento la espone — ma se
     * c'è deve riferirsi a qualcosa. Una riga orfana produrrebbe un confronto
     * fra un numero e il nulla.
     */
    const batch = await fetchBatch();
    const sprintIds = new Set(batch.sprints.map((sprint) => sprint.id));

    for (const entry of batch.sprintStatistics) {
      expect(sprintIds.has(entry.sprintId), `previsione orfana: ${entry.id}`).toBe(true);
    }
  });

  it("non registra due previsioni per lo stesso sprint", async () => {
    // Due previsioni non lasciano modo di dire su quale la squadra ha
    // pianificato — e «la più recente» è la risposta sbagliata, perché è stata
    // fatta con informazioni che il piano non aveva.
    const batch = await fetchBatch();
    const seen = new Set<string>();

    for (const entry of batch.sprintStatistics) {
      expect(seen.has(entry.sprintId), `due previsioni per ${entry.sprintId}`).toBe(false);
      seen.add(entry.sprintId);
    }
  });

  it("ogni nota e ogni miglioramento appartengono a una retrospettiva del lotto", async () => {
    /*
     * Una nota orfana è peggio di una nota assente: comparirebbe in nessuna
     * riunione, quindi in nessuna schermata, e nessuno saprebbe che c'è.
     */
    const batch = await fetchBatch();
    const retrospectiveIds = new Set(batch.retrospectives.map((entry) => entry.id));

    for (const note of batch.retrospectiveNotes) {
      expect(
        retrospectiveIds.has(note.retrospectiveId),
        `nota orfana: ${note.id}`,
      ).toBe(true);
    }

    for (const action of batch.improvementActions) {
      expect(
        retrospectiveIds.has(action.retrospectiveId),
        `miglioramento orfano: ${action.id}`,
      ).toBe(true);
    }
  });

  it("un miglioramento chiuso ha un istante di risoluzione, e viceversa", async () => {
    // Senza l'istante non si può dire quanto ci è voluto; con l'istante ma
    // ancora aperto, la storia si contraddice.
    const batch = await fetchBatch();

    for (const action of batch.improvementActions) {
      if (action.status === "open") {
        expect(action.resolvedAt, `aperto ma risolto: ${action.id}`).toBeNull();
      } else {
        expect(action.resolvedAt, `chiuso senza istante: ${action.id}`).not.toBeNull();
      }
    }
  });

  it("non colloca una transizione prima della creazione dell'elemento", async () => {
    const batch = await fetchBatch();
    const items = new Map(batch.workItems.map((item) => [item.id, item]));

    for (const transition of batch.transitions) {
      const item = items.get(transition.workItemId);
      if (!item) continue;

      expect(
        transition.occurredAt.getTime(),
        `transizione anteriore alla creazione di ${item.sourceId}`,
      ).toBeGreaterThanOrEqual(item.sourceCreatedAt.getTime());
    }
  });

  it("ogni riferimento punta a qualcosa che esiste nel lotto", async () => {
    const batch = await fetchBatch();

    const itemIds = new Set(batch.workItems.map((item) => item.id));
    const sprintIds = new Set(batch.sprints.map((sprint) => sprint.id));
    const personIds = new Set(batch.people.map((person) => person.id));

    for (const transition of batch.transitions) {
      expect(itemIds.has(transition.workItemId)).toBe(true);
      if (transition.actorId) expect(personIds.has(transition.actorId)).toBe(true);
    }

    for (const item of batch.workItems) {
      if (item.sprintId) expect(sprintIds.has(item.sprintId)).toBe(true);
      if (item.assigneeId) expect(personIds.has(item.assigneeId)).toBe(true);
    }

    for (const event of batch.scopeEvents) {
      expect(sprintIds.has(event.sprintId)).toBe(true);
      expect(itemIds.has(event.workItemId)).toBe(true);
    }

    for (const comment of batch.comments) {
      expect(itemIds.has(comment.workItemId)).toBe(true);
    }
  });

  it("gli sprint hanno una fine successiva all'inizio e non si sovrappongono", async () => {
    const batch = await fetchBatch();
    const ordered = [...batch.sprints].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );

    for (const sprint of ordered) {
      expect(sprint.endsAt.getTime()).toBeGreaterThan(sprint.startsAt.getTime());
    }

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current) continue;

      expect(current.startsAt.getTime()).toBeGreaterThanOrEqual(previous.endsAt.getTime());
    }
  });

  it("un elemento concluso non torna a essere l'ultimo stato di una storia aperta", async () => {
    const batch = await fetchBatch();

    for (const item of batch.workItems) {
      if (!isTerminalState(item.state)) continue;

      const history = batch.transitions.filter((t) => t.workItemId === item.id);
      expect(history.length, `elemento concluso senza storia: ${item.sourceId}`).toBeGreaterThan(0);
    }
  });

  it("rispetta il cursore di sincronizzazione", async () => {
    // Un connettore che ignora `since` e restituisce tutto rende inutile
    // l'incrementalità, e nessuno se ne accorge finché i volumi non crescono.
    const full = await fetchBatch();
    const ordered = [...full.transitions].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const midpoint = ordered[Math.floor(ordered.length / 2)];
    if (!midpoint) throw new Error("il lotto completo non contiene transizioni");

    const incremental = await fetchBatch(midpoint.occurredAt);

    expect(incremental.transitions.length).toBeLessThan(full.transitions.length);
    for (const transition of incremental.transitions) {
      expect(transition.occurredAt.getTime()).toBeGreaterThanOrEqual(
        midpoint.occurredAt.getTime(),
      );
    }
  });
}
