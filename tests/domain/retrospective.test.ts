import { describe, expect, it } from "vitest";

import {
  mayShowVotes,
  retrospectiveNoteSchema,
  retrospectiveSchema,
  improvementActionSchema,
  MIN_PARTICIPANTS_FOR_VOTES,
  VOTES_PER_PARTICIPANT,
} from "@/domain";

/**
 * La retrospettiva nel modello canonico.
 *
 * Qui si verifica la forma, e soprattutto le due assenze che la rendono
 * difendibile: **nessun autore** su una nota, **nessun elenco di votanti** su un
 * miglioramento.
 */

const SCOPE = {
  organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21",
  projectId: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
} as const;

const RETRO = "11111111-0000-4000-8000-000000000001";

const BASE_RETRO = {
  id: RETRO,
  ...SCOPE,
  sprintId: "2c7f4a18-3e5b-4d69-9a02-8f6b1c4d7e35",
  heldAt: "2026-04-17T16:00:00.000Z",
  participantCount: 5,
  createdAt: "2026-04-17T16:00:00.000Z",
  updatedAt: "2026-04-17T16:00:00.000Z",
};

const BASE_NOTE = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  ...SCOPE,
  retrospectiveId: RETRO,
  column: "good" as const,
  text: "Le storie erano abbastanza piccole.",
  createdAt: "2026-04-17T16:00:00.000Z",
  updatedAt: "2026-04-17T16:00:00.000Z",
};

const BASE_ACTION = {
  id: "cccccccc-0000-4000-8000-000000000003",
  ...SCOPE,
  retrospectiveId: RETRO,
  title: "Guardare la colonna «in revisione» a ogni daily",
  detail: null,
  votes: 11,
  status: "open" as const,
  resolvedAt: null,
  createdAt: "2026-04-17T16:00:00.000Z",
  updatedAt: "2026-04-17T16:00:00.000Z",
};

describe("le tre colonne del libro", () => {
  it("accetta le tre colonne e rifiuta le altre", () => {
    for (const column of ["good", "could-have-done-better", "improvement"]) {
      expect(retrospectiveNoteSchema.parse({ ...BASE_NOTE, column }).column).toBe(column);
    }

    /*
     * «Could have done better» non è il negativo di «good»: una chiede cosa
     * ripetere, l'altra cosa cambiare. Un insieme aperto — o una polarità
     * positivo/negativo — perderebbe la distinzione che rende utile
     * l'esercizio.
     */
    expect(() =>
      retrospectiveNoteSchema.parse({ ...BASE_NOTE, column: "negative" }),
    ).toThrow();
  });

  it("una nota non ha un autore, ed è una decisione", () => {
    /*
     * Il formato del libro è un muro di Post-it anonimi. Attaccarci un nome
     * trasformerebbe «cosa poteva andare meglio» nel registro di chi si è
     * lamentato — il modo più rapido per far smettere una squadra di dire
     * qualcosa — e metterebbe un conteggio per persona a una query di
     * distanza (§8.2).
     */
    const note = retrospectiveNoteSchema.parse(BASE_NOTE);

    expect(Object.keys(note)).not.toContain("authorId");
    expect(Object.keys(note)).not.toContain("personId");
  });

  it("rifiuta una nota vuota", () => {
    expect(() => retrospectiveNoteSchema.parse({ ...BASE_NOTE, text: "   " })).toThrow();
  });
});

describe("i miglioramenti decisi", () => {
  it("conserva i voti come totale, mai come elenco di votanti", () => {
    const action = improvementActionSchema.parse(BASE_ACTION);

    expect(typeof action.votes).toBe("number");
    expect(Object.keys(action)).not.toContain("voters");
    expect(Object.keys(action)).not.toContain("votedBy");
  });

  it("ammette «lasciato cadere» come esito, non solo fatto o non fatto", () => {
    // Il libro lo dice esplicitamente: a volte basta aver visto il problema.
    expect(
      improvementActionSchema.parse({ ...BASE_ACTION, status: "dropped" }).status,
    ).toBe("dropped");
  });

  it("rifiuta un numero di voti negativo", () => {
    expect(() => improvementActionSchema.parse({ ...BASE_ACTION, votes: -1 })).toThrow();
  });

  it("tiene l'istante di risoluzione separato da updatedAt", () => {
    /*
     * `updatedAt` si muove anche per un refuso corretto nel titolo. Solo
     * `resolvedAt` dice quando qualcuno ha deciso che il miglioramento era
     * arrivato, ed è l'unico istante da cui si può misurare quanto ci è
     * voluto.
     */
    const action = improvementActionSchema.parse({
      ...BASE_ACTION,
      status: "done",
      resolvedAt: "2026-04-25T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    });

    expect(action.resolvedAt?.toISOString()).toBe("2026-04-25T10:00:00.000Z");
    expect(action.updatedAt.toISOString()).not.toBe(action.resolvedAt?.toISOString());
  });
});

describe("i voti si mostrano solo se il gruppo li nasconde davvero", () => {
  it("con tre o più partecipanti si possono mostrare", () => {
    expect(MIN_PARTICIPANTS_FOR_VOTES).toBe(3);
    expect(mayShowVotes(retrospectiveSchema.parse({ ...BASE_RETRO, participantCount: 3 }))).toBe(
      true,
    );
  });

  it("con due partecipanti no", () => {
    /*
     * Con due persone nella stanza, un totale di quattro voti su un elemento
     * dice quasi esattamente come ha votato ciascuna: l'aggregato smette di
     * essere un aggregato (§8.2).
     */
    expect(mayShowVotes(retrospectiveSchema.parse({ ...BASE_RETRO, participantCount: 2 }))).toBe(
      false,
    );
  });
});

describe("le costanti del libro", () => {
  it("tre magnetini a testa", () => {
    // «Each team member was given three magnets» (pag. 87).
    expect(VOTES_PER_PARTICIPANT).toBe(3);
  });
});

describe("la retrospettiva", () => {
  it("registra quante persone c'erano, mai chi", () => {
    const retro = retrospectiveSchema.parse(BASE_RETRO);

    expect(typeof retro.participantCount).toBe("number");
    expect(Object.keys(retro)).not.toContain("participants");
    expect(Object.keys(retro)).not.toContain("members");
  });

  it("non registra alcun umore né punteggio di clima", () => {
    /*
     * §8.2 vieta l'inferenza di stati d'animo nel contesto lavorativo, e una
     * retrospettiva è il punto in cui un prodotto ben intenzionato comincerebbe
     * a farlo. Qui si conserva ciò che le persone hanno **detto**; nessuno lo
     * punteggia.
     */
    const retro = retrospectiveSchema.parse(BASE_RETRO);

    for (const forbidden of ["mood", "sentiment", "morale", "happiness", "climate"]) {
      expect(Object.keys(retro)).not.toContain(forbidden);
    }
  });
});
