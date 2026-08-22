import { z } from "zod";

import { auditFields, displayNameSchema, projectScopedFields, timestampSchema } from "./common";
import { scrumAgentIdSchema } from "./ids";
import { createProjectContextInputSchema } from "./project-context";
import { skillKeyReferenceSchema, skillKeySchema, tokenBudgetSchema } from "./skill";

/**
 * `ScrumAgent` is the Scrum Master AI of one project (glossary §1): a
 * configuration, not a trained model. Everything a skill needs to know about
 * *how* to speak and *how far* it may go lives here, so no skill has to invent
 * its own settings.
 *
 * One agent per project, and the agent never crosses projects: it is the shape
 * the product is described in, and widening it later costs nothing while
 * narrowing it would break saved configurations.
 */

/**
 * `AgentPersona` — the role the agent takes on when it communicates.
 *
 * Affects the register, **never the facts** (glossary §4). A closed list rather
 * than free text (spec Q3): this value reaches a prompt in T4, and a free-text
 * persona is an injection surface offered to an internal user. Widening a
 * closed set later breaks nothing; narrowing a free-text field breaks every
 * configuration already saved.
 *
 * Named `AgentPersona` and not `Persona` because `Person` is the human in the
 * ingested sources, and the two must not be confusable.
 */
export const agentPersonaSchema = z.enum([
  "facilitator",
  "flow_analyst",
  "stakeholder_communicator",
]);

export type AgentPersona = z.infer<typeof agentPersonaSchema>;

/**
 * `AgentTone` — the communicative register.
 *
 * `supportive` qualifies how the agent writes, not how the team feels: no tone
 * authorises inferring anyone's mood (§8.2).
 */
export const agentToneSchema = z.enum(["neutral", "concise", "supportive", "formal"]);

export type AgentTone = z.infer<typeof agentToneSchema>;

/**
 * The language of the agent's **output**, distinct from the language of the
 * interface, which is Italian by rule (§7).
 *
 * Closed set for the same reason as the persona: it is injected into the
 * request (criterio 23). Whether the default should instead be an attribute of
 * the organization is spec Q2, still open — a question about where the value
 * comes from, not about its shape, so the contract is unaffected either way.
 */
export const agentLanguageSchema = z.enum(["it", "en"]);

export type AgentLanguage = z.infer<typeof agentLanguageSchema>;

/**
 * `AgentStatus` — an agent is suspended, never deleted (spec Q7).
 *
 * Suspension keeps the configuration and the run register while refusing every
 * execution: the same reasoning that archives a project instead of erasing its
 * history.
 */
export const agentStatusSchema = z.enum(["active", "suspended"]);

export type AgentStatus = z.infer<typeof agentStatusSchema>;

/**
 * `AutonomyLevel` — how far the agent may go (glossary §4).
 *
 * The full ladder, ordered from least to most capable. This is the
 * **vocabulary** of the domain: the catalogue declares the minimum level a
 * skill requires on this scale, and a value already stored must stay readable
 * even if a later release writes one this one would refuse.
 */
export const autonomyLevelSchema = z.enum([
  "observe",
  "report",
  "advise",
  "act_with_approval",
  "autonomous",
]);

export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

/**
 * The levels a caller may actually set today.
 *
 * **Why two schemas and not one.** They answer different questions. The ladder
 * above names what the domain can talk about; this one is the policy of T3:
 * `advise` and beyond describe behaviour nobody has built — there is no private
 * channel and no approval step — so setting them is a validation error (spec
 * Q1, criterio 12).
 *
 * Collapsing them into a single enum would force a choice between two damages:
 * deleting names the catalogue and the roadmap need, or scattering the T3
 * restriction across every call site as a hand-written `if`. Derived with
 * `.extract` so it is provably a subset, and so widening it in T5 is one edit
 * in one place.
 */
export const selectableAutonomyLevelSchema = autonomyLevelSchema.extract([
  "observe",
  "report",
]);

export type SelectableAutonomyLevel = z.infer<typeof selectableAutonomyLevelSchema>;

/** Ascending capability. Used to answer "does this agent reach what the skill requires?". */
const AUTONOMY_RANK: Readonly<Record<AutonomyLevel, number>> = {
  observe: 10,
  report: 20,
  advise: 30,
  act_with_approval: 40,
  autonomous: 50,
};

/**
 * True when `level` is at least as capable as `required`.
 *
 * A single comparison helper, as for `roleAtLeast`: enabling a skill, refusing
 * one, and disabling one after the level is lowered are three call sites of the
 * same rule, and three copies of it would eventually disagree.
 */
export function autonomyAtLeast(level: AutonomyLevel, required: AutonomyLevel): boolean {
  return AUTONOMY_RANK[level] >= AUTONOMY_RANK[required];
}

/** Enough for a demonstration, low enough to protect a free tier from a loop (spec Q6). */
export const DEFAULT_MAX_RUNS_PER_DAY = 50;

/**
 * A ceiling on the ceiling.
 *
 * The daily cap protects the free tier; this protects against the cap itself
 * being set to something that defeats the purpose. A thousand runs a day is far
 * beyond any plausible use of this product and well past every free quota, so
 * the bound catches a typo — an extra zero — rather than a preference.
 */
export const MAX_RUNS_PER_DAY_LIMIT = 1000;
export const dailyRunLimitSchema = z.number().int().positive().max(MAX_RUNS_PER_DAY_LIMIT);

/**
 * `AgentPolicy` — the operational limits the **code** enforces (glossary §4).
 *
 * Only what is configurable lives here. The non-disableable prohibitions — no
 * evaluation of individuals, no inference of moods, ingested text is data, no
 * writes towards external systems (§8.1, §8.2) — are deliberately absent:
 * giving them a field would suggest a field can be turned off. They are shown
 * read-only in the interface and enforced by the runtime.
 */
export const agentPolicySchema = z.object({
  /**
   * `null` means "do not reduce": the budget declared by the skill applies.
   *
   * Storing a copy of the catalogue's value instead would go stale the day the
   * skill changes its own declaration, and nobody would notice.
   */
  maxTokensPerRun: tokenBudgetSchema.nullable(),

  maxRunsPerDay: dailyRunLimitSchema,
});

export type AgentPolicy = z.infer<typeof agentPolicySchema>;

/**
 * The budget that actually applies to one run.
 *
 * The invariant is one-directional: a policy may only **lower** what the skill
 * declared, never raise it (glossary, `TokenBudget`).
 */
export function effectiveTokenBudget(policy: AgentPolicy, declaredBySkill: number): number {
  return policy.maxTokensPerRun === null
    ? declaredBySkill
    : Math.min(declaredBySkill, policy.maxTokensPerRun);
}

/**
 * The skills a caller asks to turn on.
 *
 * The closed enum here, unlike the stored form: you may only enable a skill
 * this release declares. Duplicates are rejected rather than collapsed, since a
 * repeated key means the caller is describing something it does not understand.
 */
export const enabledSkillKeysInputSchema = z
  .array(skillKeySchema)
  .refine((keys) => new Set(keys).size === keys.length, {
    message: "Ogni skill può comparire una sola volta.",
  });

export const DEFAULT_AGENT_PERSONA: AgentPersona = "facilitator";
export const DEFAULT_AGENT_TONE: AgentTone = "neutral";
export const DEFAULT_AGENT_LANGUAGE: AgentLanguage = "it";
export const DEFAULT_AUTONOMY_LEVEL: SelectableAutonomyLevel = "observe";

/** The longest a display name may be, mirroring `displayNameSchema`. */
const MAX_AGENT_NAME_LENGTH = 120;

const AGENT_NAME_PREFIX = "Scrum Master di ";

/**
 * The name the wizard proposes (criterio 9).
 *
 * Lives here rather than in the interface because it is a rule about a domain
 * value, and a rule written in a page gets written a second time in the test
 * that checks the page — at which point the two can disagree.
 *
 * The truncation is the point. Both the project name and the agent name are
 * `displayNameSchema`, capped at the same length: a project called something
 * long enough would produce a proposal one character over the limit, and the
 * wizard could no longer be completed *without typing anything*, which criteri
 * 8 and 31 require. Cutting on a word boundary and adding an ellipsis says the
 * name was shortened, instead of leaving a sentence that stops mid-word.
 */
export function defaultScrumAgentName(projectName: string): string {
  const proposed = `${AGENT_NAME_PREFIX}${projectName.trim()}`;
  if (proposed.length <= MAX_AGENT_NAME_LENGTH) return proposed;

  const room = MAX_AGENT_NAME_LENGTH - AGENT_NAME_PREFIX.length - 1;
  const cut = proposed.slice(AGENT_NAME_PREFIX.length, AGENT_NAME_PREFIX.length + room);
  const lastSpace = cut.lastIndexOf(" ");

  // Only cut on a word boundary if one is reasonably close, otherwise a single
  // very long word would be trimmed down to almost nothing.
  const kept = lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut.trimEnd();

  return `${AGENT_NAME_PREFIX}${kept}…`;
}

export const scrumAgentSchema = z.object({
  id: scrumAgentIdSchema,
  ...projectScopedFields,

  name: displayNameSchema,
  persona: agentPersonaSchema,
  tone: agentToneSchema,
  language: agentLanguageSchema,

  /**
   * The full ladder on the way out, the restricted one on the way in: what was
   * written yesterday must remain readable today.
   */
  autonomyLevel: autonomyLevelSchema,

  status: agentStatusSchema,

  /**
   * References, not catalogue entries: a key retired in a later release is
   * ignored when read and reported on the card, and the agent still loads
   * (spec §7).
   */
  enabledSkillKeys: z.array(skillKeyReferenceSchema),

  policy: agentPolicySchema,

  ...auditFields,
});

export type ScrumAgent = z.infer<typeof scrumAgentSchema>;

/** Same shape as the policy, carrying the proposed values. */
export const agentPolicyInputSchema = z.object({
  maxTokensPerRun: tokenBudgetSchema.nullable().default(null),
  maxRunsPerDay: dailyRunLimitSchema.default(DEFAULT_MAX_RUNS_PER_DAY),
});

/**
 * Everything the wizard confirms, in one payload, because the creation is
 * atomic: agent, project context and skill enablements are born together or
 * not at all (criterio 3).
 *
 * `organizationId` and `projectId` are absent: the tenant comes from the
 * session and the project from the address. Accepting either from the body
 * would let a caller name a project it cannot see, which is the class of bug
 * §8.4 exists to prevent. `status` is absent because an agent is always born
 * active, and `id` because identifiers are ours.
 *
 * Only `name` has no default, and the wizard arrives with it prefilled: an
 * empty payload beyond the name parses into exactly the values of criterio 8.
 */
export const createScrumAgentInputSchema = scrumAgentSchema.pick({ name: true }).extend({
  persona: agentPersonaSchema.default(DEFAULT_AGENT_PERSONA),
  tone: agentToneSchema.default(DEFAULT_AGENT_TONE),
  language: agentLanguageSchema.default(DEFAULT_AGENT_LANGUAGE),
  autonomyLevel: selectableAutonomyLevelSchema.default(DEFAULT_AUTONOMY_LEVEL),
  enabledSkillKeys: enabledSkillKeysInputSchema.default([]),
  policy: agentPolicyInputSchema.prefault({}),
  context: createProjectContextInputSchema.prefault({}),
});

export type CreateScrumAgentInput = z.infer<typeof createScrumAgentInputSchema>;

/**
 * One section of the card being saved, hence every field optional.
 *
 * `expectedUpdatedAt` stays required: it is the version the editor was looking
 * at, and it is what turns a concurrent save into a conflict instead of a
 * silent overwrite.
 *
 * Lowering `autonomyLevel` below what an enabled skill requires is not refused
 * here: the spec asks for those skills to be disabled and **listed back** to
 * the user (criterio 16), which is a decision of the runtime and needs
 * `autonomyAtLeast` plus the catalogue, not a schema.
 */
export const updateScrumAgentInputSchema = scrumAgentSchema
  .pick({ name: true, persona: true, tone: true, language: true, status: true })
  .extend({
    autonomyLevel: selectableAutonomyLevelSchema,
    enabledSkillKeys: enabledSkillKeysInputSchema,
    policy: agentPolicySchema,
  })
  .partial()
  .extend({ expectedUpdatedAt: timestampSchema });

export type UpdateScrumAgentInput = z.infer<typeof updateScrumAgentInputSchema>;
