/**
 * The `sprint-report` skill.
 *
 * Split into three pieces that can each be tested without a model:
 * `evidence` chooses what the model sees, `snapshot` writes every number out,
 * and `fidelity` decides whether the text that comes back may be shown.
 *
 * Nothing here calls a provider. The call itself belongs to the gateway
 * (ADR-0004), which keeps everything above testable without a network.
 */
export * from "./evidence";
export * from "./fidelity";
export * from "./snapshot";
