/**
 * The `daily-digest` skill: what moved yesterday, and what did not.
 *
 * The counting lives in `src/metrics/daily.ts` (R1). What is here is the step
 * after: writing it up, and refusing the version that reports only progress.
 *
 * This is also the first skill besides the sprint report whose prompt carries
 * text somebody else wrote — the item titles — so it is the one where §8.1
 * matters most.
 */
export * from "./generate";
export * from "./snapshot";
