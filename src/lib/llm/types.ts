import type { LlmProvider, SkillRunFailureCause } from "@/domain";

/**
 * The port every provider plugs into.
 *
 * ADR-0004 forbids calling a model SDK anywhere outside `src/lib/llm`. Declaring
 * the provider as a port rather than importing a vendor library here means the
 * dependency lives in exactly one adapter file, and that the gateway — where
 * budget, fallback and measurement live — can be tested without a network, a
 * key, or a vendor package installed at all.
 *
 * It also keeps ADR-0005 honest: *«una skill non sa quale modello l'ha
 * servita»*. Nothing in this file leaks a vendor name to a caller.
 */

/** A block of third-party text, labelled with where it came from. */
export type UntrustedBlock = {
  readonly label: string;
  readonly content: string;
};

/**
 * What the gateway sends.
 *
 * `system` and `untrustedData` are separate fields, and it is not a stylistic
 * choice. Ingested text is data, never instruction (§8.1): keeping it out of
 * the system prompt is what lets an adapter delimit and label it, and what lets
 * a test assert that a working agreement never reached a place where it could
 * be read as a command.
 */
export type LlmRequest = {
  /** Instructions written by us, versioned in the repository. */
  readonly system: string;
  /** The question being asked. Composed by code, never by a third party. */
  readonly prompt: string;
  /**
   * Untrusted material, already narrowed by a deterministic pre-filter (§9).
   * Absent in T3: `configuration-check` sends no project data at all.
   */
  readonly untrustedData?: readonly UntrustedBlock[] | undefined;
  /** The ceiling for this call, already reconciled between skill and policy. */
  readonly maxTokens: number;
  /** Drives the language of the answer, never its content. */
  readonly language: string;
};

/** What a provider gives back when it answers. */
export type LlmResponse = {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The concrete model, as the provider names it. */
  readonly model: string;
};

/**
 * A provider failure the gateway can reason about.
 *
 * Carrying a cause rather than a bare `Error` is what lets the gateway decide
 * whether the backup is worth trying: a rate limit is, a malformed request is
 * not. An adapter that cannot classify a failure says `provider_unavailable`,
 * which is honest, instead of guessing something more specific.
 */
export class LlmProviderError extends Error {
  constructor(
    readonly failureCause: SkillRunFailureCause,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

export type LlmProviderAdapter = {
  readonly name: LlmProvider;
  /**
   * `false` when the credential is missing.
   *
   * Checked rather than discovered through a failed call: a provider nobody
   * configured should be skipped, not tried and reported as unavailable.
   */
  readonly isConfigured: () => boolean;
  readonly complete: (request: LlmRequest) => Promise<LlmResponse>;
};
