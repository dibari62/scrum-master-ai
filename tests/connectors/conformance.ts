import { expect, it } from "vitest";

import { findHistoryDefects, isTerminalState, type StateTransition } from "@/domain";

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
  const fetchBatch = (since?: Date): Promise<CanonicalBatch> =>
    options.connector.fetch({
      organizationId: options.organizationId as never,
      projectId: options.projectId as never,
      since,
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
