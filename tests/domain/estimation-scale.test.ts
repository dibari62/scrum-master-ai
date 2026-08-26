import { describe, expect, it } from "vitest";

import {
  ESTIMATION_SCALE_VALUES,
  FIBONACCI_SCALE,
  isOnScale,
  neighboursOnScale,
  PLANNING_POKER_DECK,
} from "@/domain";

describe("scala di stima", () => {
  describe("il mazzo del planning poker", () => {
    /*
     * Il vincolo di pag. 38: «Each team member gets a deck of 13 cards».
     *
     * Undici sono numeri, due no: `?` («I have absolutely no idea») e la
     * tazzina («I'm too tired to think»). Non sono dimensioni di una storia ma
     * risposte sullo stimatore, e nel modello canonico quello stato è
     * `estimate: null`. Il test conta gli undici numerici e dichiara perché
     * non sono tredici.
     */
    it("ha undici valori numerici, che con le due carte non numeriche fanno le tredici del libro", () => {
      expect(PLANNING_POKER_DECK).toHaveLength(11);
    });

    it("non ammette il 7, che è l'esempio con cui il libro spiega la scala", () => {
      expect(PLANNING_POKER_DECK).not.toContain(7);
    });

    it("il mezzo punto è la carta più piccola e viene ammesso", () => {
      // «Our lowest value is 0.5» (pag. 65).
      expect(isOnScale("planning-poker", { value: 0.5, unit: "points" })).toBe(true);
      expect(Math.min(...PLANNING_POKER_DECK)).toBe(0);
      expect(PLANNING_POKER_DECK.filter((value) => value > 0 && value < 1)).toEqual([0.5]);
    });

    it("fra 40 e 100 non c'è nulla, come dice il libro", () => {
      expect(PLANNING_POKER_DECK.filter((value) => value > 40 && value < 100)).toEqual([]);
    });

    it("è ordinato in modo crescente, perché i vicini si leggono dalla posizione", () => {
      const sorted = [...PLANNING_POKER_DECK].sort((a, b) => a - b);
      expect(PLANNING_POKER_DECK).toEqual(sorted);
    });
  });

  describe("appartenenza alla scala", () => {
    it("una stima assente non è mai fuori scala", () => {
      expect(isOnScale("planning-poker", null)).toBe(true);
    });

    /*
     * Le ore non si giudicano col mazzo.
     *
     * «3 ore» è una durata, non una dimensione: i salti del mazzo servono a
     * impedire una precisione finta sulle stime relative, e su un orologio non
     * significano nulla. È la stessa restrizione che ADR-0008 mette sul focus
     * factor, per la stessa ragione.
     */
    it("non giudica le stime in ore, perché il mazzo misura dimensioni e non durate", () => {
      expect(isOnScale("planning-poker", { value: 7, unit: "hours" })).toBe(true);
    });

    it("senza scala dichiarata ammette qualunque valore", () => {
      expect(isOnScale("free", { value: 7, unit: "points" })).toBe(true);
      expect(ESTIMATION_SCALE_VALUES.free).toBeNull();
    });

    it("il 20 sta sul planning poker ma non sulla Fibonacci", () => {
      expect(isOnScale("planning-poker", { value: 20, unit: "points" })).toBe(true);
      expect(isOnScale("fibonacci", { value: 20, unit: "points" })).toBe(false);

      // E il rovescio: il 21 è Fibonacci stretta, non è una carta del mazzo.
      expect(isOnScale("fibonacci", { value: 21, unit: "points" })).toBe(true);
      expect(isOnScale("planning-poker", { value: 21, unit: "points" })).toBe(false);
    });

    it("le due scale coincidono fino a 13 e divergono sopra", () => {
      const shared = PLANNING_POKER_DECK.filter((value) => value <= 13 && value !== 0.5);
      expect(FIBONACCI_SCALE.filter((value) => value <= 13)).toEqual(shared);
    });
  });

  describe("i valori vicini", () => {
    it("un 7 sta fra 5 e 8, che è la frase esatta del libro", () => {
      expect(neighboursOnScale("planning-poker", 7)).toEqual({ below: 5, above: 8 });
    });

    it("sopra la carta più grande non nomina un valore superiore", () => {
      expect(neighboursOnScale("planning-poker", 150)).toBeNull();
    });

    it("un valore ammesso non ha vicini da suggerire", () => {
      expect(neighboursOnScale("planning-poker", 8)).toBeNull();
    });

    it("senza scala dichiarata non suggerisce nulla", () => {
      expect(neighboursOnScale("free", 7)).toBeNull();
    });

    it("un valore fra le due carte più basse trova comunque i suoi vicini", () => {
      expect(neighboursOnScale("planning-poker", 0.25)).toEqual({ below: 0, above: 0.5 });
    });
  });
});
