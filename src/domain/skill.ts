import { z } from "zod";

import { auditFields, projectScopedFields, timestampSchema } from "./common";
import { scrumAgentIdSchema, skillRunIdSchema } from "./ids";

/**
 * What a `ScrumAgent` can be asked to do, and the trace of what it did
 * (glossary §4).
 *
 * A skill is a typed function, not a conversation (ADR-0004): its identity, its
 * trigger and its cost are declared data, so an execution can be budgeted
 * before it starts and audited after it ends.
 */

/**
 * Stable identifiers of the declared skills.
 *
 * A key is persisted on every enablement and on every run, so it is renamed
 * never: renaming one would silently disable the skill on every agent that had
 * it on, and orphan its history.
 *
 * The list deliberately names skills that cannot run yet. The catalogue has to
 * show them as declarations of intent (spec §4, passo 3), and what may actually
 * execute is decided by `isSkillAvailable`, not by membership in this enum.
 */
export const skillKeySchema = z.enum([
  "configuration-check",
  "sprint-report",
  "daily-digest",
  "sprint-health",
  "bottleneck-detection",
  "project-qa",
]);

export type SkillKey = z.infer<typeof skillKeySchema>;

/**
 * Skills this release can actually execute.
 *
 * `configuration-check` is alone on purpose: T3 builds the object and the
 * plumbing, not the capabilities. Everything else is refused **before** the
 * gateway, so a declaration of intent never consumes a token.
 */
const AVAILABLE_SKILL_KEYS: ReadonlySet<SkillKey> = new Set(["configuration-check"]);

export function isSkillAvailable(key: SkillKey): boolean {
  return AVAILABLE_SKILL_KEYS.has(key);
}

/**
 * A skill key as it comes **back from storage**.
 *
 * Deliberately laxer than `skillKeySchema`: an agent configured by an earlier
 * release may reference a key this release no longer declares, and reading it
 * as the closed enum would turn a retired catalogue entry into an agent that
 * cannot be loaded at all. The card shows the unknown key as no longer
 * available (spec §7) instead of failing.
 *
 * The laxness stops at reading: only a value accepted by `isKnownSkillKey` may
 * be enabled or executed.
 */
export const skillKeyReferenceSchema = z.string().trim().min(1).max(64);

export function isKnownSkillKey(value: string): value is SkillKey {
  return skillKeySchema.safeParse(value).success;
}

/**
 * What starts a skill.
 *
 * In T3 only `on_demand` is wired to anything: `scheduled` and `event` are part
 * of the vocabulary because the catalogue declares which triggers a skill will
 * admit, and the mechanism arrives in T5.
 */
export const triggerSchema = z.enum(["scheduled", "event", "on_demand"]);

export type Trigger = z.infer<typeof triggerSchema>;

/**
 * Two outcomes only.
 *
 * A run refused by our own rules — budget, daily cap, suspended agent — is a
 * `failed` run and not an absence of run: the decision is ours, and a decision
 * nobody can see is indistinguishable from a bug.
 */
export const skillRunStatusSchema = z.enum(["succeeded", "failed"]);

export type SkillRunStatus = z.infer<typeof skillRunStatusSchema>;

/**
 * Why a run failed.
 *
 * Closed set, and each value maps to a different thing the reader can do about
 * it: configure a key, wait, retry, raise a cap. "Failed" without a cause is
 * not diagnosable, and the interface is required to say what happened *and*
 * what to do (spec §9).
 */
export const skillRunFailureCauseSchema = z.enum([
  "budget_exceeded",
  "quota_exceeded",
  "provider_not_configured",
  "provider_unavailable",
  "rate_limited",
  "timeout",
  "invalid_output",
  "agent_suspended",
]);

export type SkillRunFailureCause = z.infer<typeof skillRunFailureCauseSchema>;

/**
 * The model vendors the gateway can talk to (ADR-0005).
 *
 * Recorded on every run because the gateway may fall back to the reserve
 * provider on its own: without this field the register could not answer "who
 * actually served this?", which is the only reason the fallback is observable.
 */
export const llmProviderSchema = z.enum(["gemini", "groq", "fake"]);

export type LlmProvider = z.infer<typeof llmProviderSchema>;

/** A ceiling that a typo cannot turn into an exhausted free tier in one call. */
export const MAX_TOKEN_BUDGET = 100_000;

/**
 * The ceiling of tokens a single run may consume (ADR-0004).
 *
 * Positive, never zero: a budget of zero would mean "declared but unusable",
 * which is what the availability of the skill already says.
 */
export const tokenBudgetSchema = z.number().int().positive().max(MAX_TOKEN_BUDGET);

export type TokenBudget = z.infer<typeof tokenBudgetSchema>;

/** Tokens actually consumed. Zero when the run was refused before reaching a provider. */
export const tokenCountSchema = z.number().int().nonnegative();

/**
 * Estimated cost in US dollars.
 *
 * Computed by code from the recorded tokens and a price list versioned in the
 * repository — never returned by a model (R1, ADR-0002). It is an estimate for
 * display, not an accounting figure, which is why a plain number is enough:
 * nobody reconciles a bill against it.
 */
export const estimatedCostUsdSchema = z.number().finite().nonnegative();

/**
 * `SkillRun` is one execution and its receipt (glossary §4).
 *
 * Exactly one row per execution that reaches the runtime, successful or not.
 * It is the only place where the cost of the product is visible, so a run that
 * failed is as interesting as one that worked — more, usually.
 */
export const skillRunSchema = z.object({
  id: skillRunIdSchema,
  ...projectScopedFields,

  scrumAgentId: scrumAgentIdSchema,

  /** A reference, not the enum: the register outlives the catalogue entry. */
  skillKey: skillKeyReferenceSchema,

  trigger: triggerSchema,

  startedAt: timestampSchema,
  finishedAt: timestampSchema,

  /**
   * Measured duration, kept alongside the two instants rather than derived from
   * them: it is read from a monotonic clock, so it stays truthful even if the
   * wall clock moves under the process.
   */
  durationMs: z.number().int().nonnegative(),

  status: skillRunStatusSchema,

  /** `null` exactly when the run succeeded. */
  failureCause: skillRunFailureCauseSchema.nullable(),

  /**
   * `null` when no provider was ever contacted — a run stopped by the budget,
   * the daily cap or a suspended agent. Distinct from "unknown provider": the
   * absence is the fact being recorded.
   */
  provider: llmProviderSchema.nullable(),

  /** The concrete model name, as reported by the provider. `null` for the same reason as above. */
  model: z.string().trim().min(1).max(120).nullable(),

  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
  estimatedCostUsd: estimatedCostUsdSchema,

  ...auditFields,
});

export type SkillRun = z.infer<typeof skillRunSchema>;

/**
 * Rejects a run whose parts contradict each other.
 *
 * Kept apart from `skillRunSchema` for the reason given in `validSprintSchema`:
 * a refined object no longer composes with `.pick()` and `.partial()`.
 */
export const validSkillRunSchema = skillRunSchema
  .refine((run) => run.finishedAt.getTime() >= run.startedAt.getTime(), {
    message: "La fine dell'esecuzione non può precedere l'inizio.",
    path: ["finishedAt"],
  })
  .refine((run) => (run.status === "failed") === (run.failureCause !== null), {
    message: "Un'esecuzione fallita dichiara una causa; una riuscita non ne ha.",
    path: ["failureCause"],
  });
