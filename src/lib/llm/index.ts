/**
 * The gateway to a language model.
 *
 * Everything a caller needs is here; nothing else in the application imports a
 * model SDK, and `npm run boundaries` is what keeps that true (ADR-0004).
 */

export * from "./types";
export * from "./gateway";
export * from "./pricing";
export { FAKE_MODEL, countTokens, createFakeProvider, renderRequest } from "./fake";
export { createGoogleProvider, DEFAULT_GEMINI_MODEL } from "./google";
export { createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
export {
  createCompatibleProvider,
  isCompatibleProvider,
  COMPATIBLE_PROFILES,
  type CompatibleProvider,
} from "./openai-compatible";
