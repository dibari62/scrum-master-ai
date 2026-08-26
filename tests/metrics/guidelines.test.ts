import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_STORIES_PER_SPRINT,
  MAX_STORY_POINTS,
  MIN_STORIES_PER_SPRINT,
  MIN_STORY_POINTS,
  planningGuidelines,
} from "@/metrics";

import { item, resetIds, uuidFor } from "./builders";

function story(name: string, points: number | null) {
  return item({
    id: uuidFor(name),
    title: name,
    estimate: points === null ? null : { value: points, unit: "points" },
  });
}

describe("planningGuidelines", () => {
  beforeEach(resetIds);

  describe("dimensione delle storie: da 2 a 8", () => {
    it("riproduce i limiti stampati nel libro", () => {
      expect(MIN_STORY_POINTS).toBe(2);
      expect(MAX_STORY_POINTS).toBe(8);
    });

    it("una storia da 13 punti supera il limite, e lo dice da che parte", () => {
      const result = planningGuidelines([story("grande", 13)]);

      expect(result.storySize).toHaveLength(1);
      expect(result.storySize[0]?.direction).toBe("above");
      expect(result.storySize[0]?.points).toBe(13);
    });

    it("una storia da 1 punto sta sotto il limite", () => {
      const result = planningGuidelines([story("minuscola", 1)]);

      expect(result.storySize).toHaveLength(1);
      expect(result.storySize[0]?.direction).toBe("below");
    });

    it("gli estremi 2 e 8 sono dentro, non fuori", () => {
      const result = planningGuidelines([story("due", 2), story("otto", 8)]);

      expect(result.storySize).toEqual([]);
      expect(result.storiesSized).toBe(2);
    });

    it("una storia senza stima non ha una dimensione da giudicare", () => {
      const result = planningGuidelines([story("da stimare", null)]);

      expect(result.storiesSized).toBe(0);
      expect(result.storySize).toEqual([]);
      // Ma resta una storia: il conteggio è di storie, non di stime.
      expect(result.storyCount).toBe(1);
    });

    it("le stime in ore non si confrontano con un limite espresso in punti", () => {
      const result = planningGuidelines([
        item({ id: uuidFor("a ore"), estimate: { value: 40, unit: "hours" } }),
      ]);

      expect(result.storiesSized).toBe(0);
      expect(result.storySize).toEqual([]);
    });

    it("un bug fuori misura non è una storia e non viene giudicato", () => {
      const oversized = { value: 21, unit: "points" as const };

      const asBug = planningGuidelines([
        item({ id: uuidFor("bug"), kind: "bug", estimate: oversized }),
      ]);
      const asStory = planningGuidelines([
        item({ id: uuidFor("storia"), kind: "story", estimate: oversized }),
      ]);

      // Stesso numero, stessa unità: cambia solo il tipo, e basta a decidere.
      expect(asBug.storySize).toEqual([]);
      expect(asBug.storyCount).toBe(0);
      expect(asStory.storySize).toHaveLength(1);
    });
  });

  describe("numero di storie per sprint: da 5 a 15", () => {
    it("riproduce i limiti stampati nel libro", () => {
      expect(MIN_STORIES_PER_SPRINT).toBe(5);
      expect(MAX_STORIES_PER_SPRINT).toBe(15);
    });

    it("quattro storie stanno sotto il minimo", () => {
      const items = [1, 2, 3, 4].map((n) => story(`s${n}`, 3));

      expect(planningGuidelines(items).storyCountDirection).toBe("below");
    });

    it("cinque storie sono dentro: il minimo è incluso", () => {
      const items = [1, 2, 3, 4, 5].map((n) => story(`s${n}`, 3));

      expect(planningGuidelines(items).storyCountDirection).toBeNull();
    });

    it("sedici storie superano il massimo", () => {
      const items = Array.from({ length: 16 }, (_, n) => story(`s${n}`, 3));

      expect(planningGuidelines(items).storyCountDirection).toBe("above");
    });

    it("uno sprint vuoto non è «troppe poche storie»", () => {
      /*
       * Zero è sotto cinque, ma dirlo manderebbe a cercare la cosa sbagliata.
       *
       * «Troppe poche storie» è un sintomo di storie troppo grandi. Uno sprint
       * senza storie è un piano che manca, o un dato che manca: un problema
       * diverso, e in un altro posto.
       */
      const result = planningGuidelines([]);

      expect(result.storyCount).toBe(0);
      expect(result.storyCountDirection).toBeNull();
    });
  });

  it("conserva l'ordine di ingresso, così due esecuzioni danno la stessa lista", () => {
    const result = planningGuidelines([
      story("grande", 13),
      story("giusta", 5),
      story("minuscola", 1),
    ]);

    expect(result.storySize.map((deviation) => deviation.title)).toEqual([
      "grande",
      "minuscola",
    ]);
  });
});
