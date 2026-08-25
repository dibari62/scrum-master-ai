/**
 * The `project-qa` skill: answering a free question, verifiably.
 *
 * Split so each half can be tested without a model: `retrieval` decides what the
 * model may see — deterministically, and explainably — and `generate` refuses
 * the answers that cannot be checked.
 *
 * This is the only skill whose output has no figures beside it on screen, which
 * is why the citations are not decoration: they are what makes the answer
 * something a reader can go and verify instead of believe.
 */
export * from "./generate";
export * from "./retrieval";
