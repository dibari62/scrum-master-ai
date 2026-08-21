/**
 * Deterministic pseudo-random numbers.
 *
 * `Math.random()` cannot be used here. Synthetic data that changes on every run
 * would make every metric change with it, and a test that asserts "velocity is
 * 23" would fail on Tuesday for no reason. Worse, a bug visible only with one
 * particular data set would be unreproducible.
 *
 * Given the same seed this produces the same sequence, on any machine and any
 * platform — so the demo data set is a fixed artefact that happens to look
 * random, not an actually random one.
 *
 * The algorithm is mulberry32: thirty-two bits of state, good enough
 * distribution for generating plausible history, and short enough to read.
 * It is **not** suitable for anything requiring unpredictability — see
 * `src/lib/password.ts` for that.
 */
export type Random = {
  /** A number in [0, 1). */
  readonly next: () => number;
  /** An integer in [min, max], both included. */
  readonly int: (min: number, max: number) => number;
  /** True with the given probability. */
  readonly chance: (probability: number) => boolean;
  /** One element, chosen uniformly. Throws on an empty list. */
  readonly pick: <T>(items: readonly T[]) => T;
};

export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`intervallo non valido: [${min}, ${max}]`);
    return min + Math.floor(next() * (max - min + 1));
  };

  const chance = (probability: number): boolean => next() < probability;

  const pick = <T,>(items: readonly T[]): T => {
    const chosen = items[int(0, items.length - 1)];
    if (chosen === undefined) throw new Error("impossibile scegliere da un elenco vuoto");
    return chosen;
  };

  return { next, int, chance, pick };
}
