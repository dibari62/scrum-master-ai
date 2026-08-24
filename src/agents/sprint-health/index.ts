/**
 * The `sprint-health` skill: explaining a verdict, never reaching one.
 *
 * The judgement itself is computed in `src/metrics/health.ts` and is not this
 * skill's business (R1). What lives here is the step after: joining five
 * separately computed signals into something readable, and refusing the answer
 * when it quotes a figure nobody produced or describes a history that does not
 * exist.
 *
 * Nothing here calls a provider — the call belongs to the gateway (ADR-0004),
 * which keeps every path above testable without a network or a key.
 */
export * from "./generate";
export * from "./snapshot";
