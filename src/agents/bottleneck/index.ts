/**
 * The `bottleneck-detection` skill: explaining where the work waits.
 *
 * The measurement — which phase absorbs the most time, and which of those
 * phases counts as a wait — lives in `src/metrics/bottleneck.ts` and is not
 * reopened here (R1). This is the step after: saying it in a sentence, and
 * refusing an answer that names a phase the code did not choose.
 */
export * from "./generate";
export * from "./snapshot";
