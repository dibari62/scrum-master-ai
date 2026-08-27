import { z } from "zod";

/**
 * The shapes Jira sends back, described only as far as we read them.
 *
 * **Deliberately partial and deliberately tolerant.** Jira returns dozens of
 * fields we have no use for, and a schema that listed them all would break the
 * day Atlassian adds one. These schemas validate what the translation touches
 * and let the rest through untouched.
 *
 * They also never leave this folder. R2 is explicit: no Jira type crosses the
 * connector boundary, so nothing here appears in a signature that `src/app`,
 * `src/metrics` or `src/agents` can see.
 */

/** An instant as Jira writes it: `2021-01-28T07:37:40.000+0000`. */
const jiraInstant = z.string().min(1);

export const jiraUserSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1).default("Sconosciuto"),
  emailAddress: z.string().nullish(),
});

export type JiraUser = z.infer<typeof jiraUserSchema>;

export const jiraFieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const jiraSprintSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  state: z.enum(["active", "closed", "future"]),
  startDate: jiraInstant.nullish(),
  endDate: jiraInstant.nullish(),

  /**
   * When the sprint was actually closed, which is not when it was due to end.
   *
   * The distinction is the reason ADR-0009 starts here rather than with Azure
   * DevOps, where it does not exist.
   */
  completeDate: jiraInstant.nullish(),
  goal: z.string().nullish(),
});

export type JiraSprint = z.infer<typeof jiraSprintSchema>;

/**
 * One field that changed inside one changelog entry.
 *
 * `from`/`to` carry identifiers, `fromString`/`toString` the readable values.
 * Both are needed: statuses are mapped by name, while sprint membership is only
 * usable by id — two sprints can share a name across boards.
 */
export const jiraChangeItemSchema = z.object({
  field: z.string().default(""),
  fieldId: z.string().nullish(),
  from: z.string().nullish(),
  fromString: z.string().nullish(),
  to: z.string().nullish(),
  toString: z.string().nullish(),
});

export type JiraChangeItem = z.infer<typeof jiraChangeItemSchema>;

export const jiraChangelogEntrySchema = z.object({
  id: z.string().min(1),
  author: jiraUserSchema.nullish(),
  created: jiraInstant,
  items: z.array(jiraChangeItemSchema).default([]),
});

export type JiraChangelogEntry = z.infer<typeof jiraChangelogEntrySchema>;

export const jiraCommentSchema = z.object({
  id: z.string().min(1),
  author: jiraUserSchema.nullish(),
  created: jiraInstant,
  /** Rendered as plain text by the client: the document format is not our problem. */
  body: z.string().default(""),
});

export const jiraIssueSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),

  fields: z.object({
    summary: z.string().default("(senza titolo)"),
    description: z.string().nullish(),
    created: jiraInstant,
    updated: jiraInstant,

    issuetype: z.object({ name: z.string().min(1) }),

    status: z.object({
      name: z.string().min(1),
      statusCategory: z.object({ key: z.string().min(1) }).nullish(),
    }),

    assignee: jiraUserSchema.nullish(),
    parent: z.object({ id: z.string().min(1) }).nullish(),

    /**
     * The sprints the issue belongs to **now**, oldest first.
     *
     * Jira keeps this in a custom field whose identifier varies per instance;
     * the client resolves it and hands over plain numbers, so the translation
     * never has to know what the field was called.
     *
     * A list rather than one value because an issue dragged forward belongs to
     * both the sprint it came from and the one it went to — which is exactly the
     * case our metrics are about.
     */
    sprintIds: z.array(z.number().int()).default([]),
  }),

  /** Values of custom fields, keyed by `customfield_NNNNN`. */
  customFields: z.record(z.string(), z.unknown()).default({}),

  changelog: z.array(jiraChangelogEntrySchema).default([]),
  comments: z.array(jiraCommentSchema).default([]),
});

export type JiraIssue = z.infer<typeof jiraIssueSchema>;

/**
 * Everything one synchronisation read, before any translation.
 *
 * The seam that makes the translation testable: a recorded snapshot is a file,
 * and a file needs no network, no token and no clock (§6).
 */
export const jiraSnapshotSchema = z.object({
  boardName: z.string().min(1),
  fields: z.array(jiraFieldSchema).default([]),
  sprints: z.array(jiraSprintSchema).default([]),

  /**
   * The issues, **in backlog order**.
   *
   * Jira ranks with an opaque string (`LexoRank`) that is only meaningful in
   * comparison, so the order is carried by the array rather than by a value on
   * each issue: the query asks for `ORDER BY Rank` and position N is position N.
   */
  issues: z.array(jiraIssueSchema).default([]),
});

export type JiraSnapshot = z.infer<typeof jiraSnapshotSchema>;
