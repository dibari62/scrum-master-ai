import { z } from "zod";

import { workItemKindSchema, workItemStateSchema } from "@/domain";

/**
 * What a project has to declare before its Jira board can be read.
 *
 * **Why a mapping and not a guess.** Jira lets every project invent its own
 * workflow: «In Review», «Code Review», «Waiting for QA», «Ready for Prod» are
 * all statuses somebody's team uses, and no amount of cleverness turns them into
 * our six canonical states reliably. ADR-0003 already says the mapping must be
 * declarative and per project — this is that declaration.
 *
 * `statusCategory` gives a usable **default** for the three obvious cases, and
 * nothing more: it knows «not started», «in progress», «done», so a status that
 * means *waiting for review* arrives as plain `in_progress` unless somebody says
 * otherwise. That is a loss of information, not a bug, and the way to recover it
 * is to write it down here.
 */

/**
 * Jira status name → canonical state.
 *
 * Keyed by **name** rather than by numeric id: an id is stable but unreadable,
 * and a configuration nobody can proofread is a configuration nobody corrects.
 * The cost is that renaming a status in Jira breaks the entry — which surfaces
 * as an unmapped status with a declared fallback, not as a silent wrong number.
 */
export const jiraStateMappingSchema = z.record(z.string().min(1), workItemStateSchema);

export type JiraStateMapping = z.infer<typeof jiraStateMappingSchema>;

/** Jira issue type name → canonical kind. */
export const jiraKindMappingSchema = z.record(z.string().min(1), workItemKindSchema);

export type JiraKindMapping = z.infer<typeof jiraKindMappingSchema>;

/**
 * The issue types Jira ships with, mapped to what we call them.
 *
 * A starting point, overridable per project. `Sub-task` becomes `task` and not
 * something of its own: our model expresses «part of a bigger thing» with
 * `parentId`, and adding a fifth kind to say the same thing twice would let the
 * two disagree.
 */
export const DEFAULT_KIND_MAPPING: JiraKindMapping = {
  Story: "story",
  Bug: "bug",
  Task: "task",
  "Sub-task": "task",
  Subtask: "task",
  Epic: "epic",
  Spike: "spike",
};

/**
 * What `statusCategory` can tell us on its own.
 *
 * Three keys, fixed by Atlassian across every instance. It is the only part of
 * the state mapping that needs no configuration, and also the only part that is
 * never enough.
 */
export const STATUS_CATEGORY_FALLBACK: Readonly<
  Record<string, z.infer<typeof workItemStateSchema>>
> = {
  new: "todo",
  indeterminate: "in_progress",
  done: "done",
};

export const jiraConfigSchema = z.object({
  /** `https://acme.atlassian.net`, without a trailing slash. */
  siteUrl: z.url(),

  /** The project key, as it appears in issue keys: `SMAI` in `SMAI-42`. */
  projectKey: z.string().min(1).max(20),

  /** The agile board the sprints belong to. */
  boardId: z.number().int().positive(),

  stateMapping: jiraStateMappingSchema,
  kindMapping: jiraKindMappingSchema.default(DEFAULT_KIND_MAPPING),

  /**
   * The names to look for when hunting the Story Points field.
   *
   * Plural because Jira has two: classic projects call it «Story Points», the
   * newer team-managed ones «Story point estimate». Configurable because a team
   * can rename it, and hard-coding the identifier is impossible anyway — the
   * `customfield_NNNNN` differs per instance, which is the single most annoying
   * fact in this whole integration.
   */
  storyPointsFieldNames: z
    .array(z.string().min(1))
    .default(["Story Points", "Story point estimate"]),

  /**
   * An optional custom field holding «how to demo».
   *
   * Jira has no such field, and the book treats it as the closest thing to an
   * acceptance criterion that fits on a card. A team that keeps one under
   * another name can point at it; everyone else gets `null`, and the Definition
   * of Ready reports the gap instead of pretending it is filled.
   */
  howToDemoFieldName: z.string().min(1).nullable().default(null),
});

export type JiraConfig = z.infer<typeof jiraConfigSchema>;

/**
 * Who is reading, as opposed to what is read.
 *
 * Jira authenticates with the pair «account email + API token», so the address
 * is half a credential. It is kept out of `jiraConfigSchema` on purpose: that
 * schema describes a board, and mixing an identity into it would mean every
 * test that builds a configuration has to invent an account.
 *
 * **Not a secret**, and the distinction is worth stating. An address
 * identifies, it does not authorise; sealing it would mean never being able to
 * show it back to the person who typed it, and «which account are we using?» is
 * a question a screen has to be able to answer. The token, which does
 * authorise, is sealed.
 */
export const jiraAccountSchema = z.object({
  accountEmail: z.email(),
});

export type JiraAccount = z.infer<typeof jiraAccountSchema>;

