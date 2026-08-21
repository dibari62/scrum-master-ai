import { describe, expect, it } from "vitest";

import { seedConnector, generateSeedBatch } from "@/connectors/seed";
import { isMidSprintAddition, organizationIdSchema, projectIdSchema } from "@/domain";

import { runConnectorConformance } from "./conformance";

const ORGANIZATION_ID = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");
const PROJECT_ID = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");

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
    });
    const second = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 42,
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
    });
    const b = generateSeedBatch({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      seed: 2,
    });

    expect(b.transitions.map((t) => t.occurredAt.toISOString())).not.toEqual(
      a.transitions.map((t) => t.occurredAt.toISOString()),
    );
  });
});

/**
 * Le anomalie sono il motivo per cui questo insieme di dati esiste.
 *
 * Un dataset che mostra una squadra sana non dimostrerebbe nulla: il prodotto
 * serve ad accorgersi dei problemi, quindi i dati devono contenerne. Questi
 * test verificano che ci siano davvero — altrimenti a T2 la dashboard
 * mostrerebbe quattro sprint identici e perfetti.
 */
describe("connettore seed — anomalie volute", () => {
  const batch = generateSeedBatch({
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
  });
  const sprints = [...batch.sprints].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );

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
});
