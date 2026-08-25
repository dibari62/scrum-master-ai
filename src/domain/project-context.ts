import { z } from "zod";

import { auditFields, displayNameSchema, projectScopedFields, timestampSchema } from "./common";
import { projectContextIdSchema } from "./ids";
import { dayOfWeekSchema } from "./working-calendar";

/**
 * `ProjectContext` is how this team has **decided** to work: sprint length,
 * ceremonies, Definition of Done, working agreement, stakeholders (glossary
 * §4).
 *
 * It is declared by a human, never inferred from the data. That is what
 * separates it from the canonical model, which only records what *happened*:
 * mixing the two would let an observation quietly become a rule.
 *
 * Every text field here is **untrusted content** (§8.1). It is written by a
 * person, but it will sit next to a prompt from T4 onwards, so it is stored as
 * data and delimited when it ever reaches a model.
 */

/**
 * Who an output is addressed to (glossary §4).
 *
 * Changes register and level of detail, never the numbers. Closed set: it is
 * used to pick a template, and a free-form audience would be a free-form
 * instruction.
 */
export const audienceSchema = z.enum(["team", "manager", "stakeholder"]);

export type Audience = z.infer<typeof audienceSchema>;

/**
 * The five Scrum events (glossary §2, "Eventi Scrum").
 *
 * Values are snake_case like every other persisted enum in the domain; the
 * glossary names them `SprintPlanning`, `DailyScrum`, … and the mapping is
 * one to one.
 */
export const scrumEventSchema = z.enum([
  "sprint_planning",
  "daily_scrum",
  "sprint_review",
  "sprint_retrospective",
  "backlog_refinement",
]);

export type ScrumEvent = z.infer<typeof scrumEventSchema>;

/**
 * The days of the week live in `working-calendar.ts`, and `dayOfWeekSchema` is
 * imported from there rather than declared again.
 *
 * R4 forbids the same shape in two places, and this is the case that makes the
 * rule concrete: a ceremony held on Friday and a Friday that counts as a
 * working day are the *same* seven values. Two enums would drift the first time
 * someone added a locale.
 */

/**
 * A wall-clock time of day, `HH:MM` on 24 hours.
 *
 * **Not an instant, so the UTC rule of §7 does not apply.** A Daily Scrum at
 * 09:30 is at 09:30 for the team every day of the year; converting it to UTC
 * would make it drift by an hour twice a year.
 */
export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "L'orario va indicato come HH:MM su 24 ore.");

export type TimeOfDay = z.infer<typeof timeOfDaySchema>;

/** `null` is the whole meaning of «non pianificata»: there is no second way to say it. */
export const ceremonySlotSchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    timeOfDay: timeOfDaySchema,
  })
  .nullable();

export type CeremonySlot = z.infer<typeof ceremonySlotSchema>;

/**
 * `CeremonySchedule` — when each Scrum event is held.
 *
 * Exhaustive over `ScrumEvent`: every ceremony is present, unscheduled ones
 * carry `null`. A partial map would make "not scheduled" and "not answered"
 * indistinguishable, and the card has to be able to say the first.
 */
export const ceremonyScheduleSchema = z.record(scrumEventSchema, ceremonySlotSchema);

export type CeremonySchedule = z.infer<typeof ceremonyScheduleSchema>;

/**
 * The starting point of the wizard, and the value of a context nobody filled in.
 *
 * Typed against `CeremonySchedule` on purpose: adding an event to the enum
 * breaks this constant at compile time instead of leaving a hole at runtime.
 */
export const UNSCHEDULED_CEREMONIES: CeremonySchedule = {
  sprint_planning: null,
  daily_scrum: null,
  sprint_review: null,
  sprint_retrospective: null,
  backlog_refinement: null,
};

export const MIN_SPRINT_LENGTH_DAYS = 1;

/** Above two months an iteration is no longer an iteration; the bound catches a typo, not a preference. */
export const MAX_SPRINT_LENGTH_DAYS = 60;

/** The fallback proposal when the project has fewer than two datable sprints (spec, criterio 10). */
export const DEFAULT_SPRINT_LENGTH_DAYS = 14;

/**
 * Declared sprint length in days.
 *
 * The wizard proposes a value computed from the canonical `Sprint` records —
 * by code, never by a model (R1) — but what is stored is what the human
 * confirmed. Out of range is a validation error, never a silent clamp.
 */
export const sprintLengthDaysSchema = z
  .number()
  .int()
  .min(MIN_SPRINT_LENGTH_DAYS)
  .max(MAX_SPRINT_LENGTH_DAYS);

export const MAX_DEFINITION_OF_DONE_ENTRIES = 20;
export const MAX_DEFINITION_OF_DONE_ENTRY_LENGTH = 200;

/** One condition of the Definition of Done: a checkable sentence, not a paragraph. */
export const definitionOfDoneEntrySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DEFINITION_OF_DONE_ENTRY_LENGTH);

/**
 * `DefinitionOfDone` — what this team requires before calling an item done.
 *
 * An empty list is legitimate and means "not declared". It is not the same as
 * the canonical state `done`, which only says where an item currently sits.
 */
export const definitionOfDoneSchema = z
  .array(definitionOfDoneEntrySchema)
  .max(MAX_DEFINITION_OF_DONE_ENTRIES);

export const MAX_WORKING_AGREEMENT_LENGTH = 4000;

/**
 * `WorkingAgreement` — the collaboration rules the team gave itself.
 *
 * `null` for "not declared", never the empty string, as everywhere else in the
 * domain. The length cap is what keeps an unbounded paste out of a future
 * prompt window.
 */
export const workingAgreementSchema = z
  .string()
  .trim()
  .max(MAX_WORKING_AGREEMENT_LENGTH)
  .nullable();

/**
 * `Stakeholder` — a recipient of the agent's communications.
 *
 * **Not a `Person`.** It carries a role and an audience and nothing else: no
 * name, no e-mail, no identifier of a human being (§8.2, spec Q5). The
 * distinction is deliberate — a `Person` works on the project and comes from an
 * ingested source, a `Stakeholder` is who the output is written for. Adding a
 * name here would put an identifiable individual on the path to a free-tier
 * provider (ADR-0005).
 */
export const stakeholderSchema = z.object({
  /** The function addressed — "Direzione commerciale" — never who currently holds it. */
  role: displayNameSchema,
  audience: audienceSchema,
});

export type Stakeholder = z.infer<typeof stakeholderSchema>;

export const MAX_STAKEHOLDERS = 20;

/**
 * The declared recipients.
 *
 * Duplicates are rejected on the offending entry rather than de-duplicated:
 * two identical rows mean the person filling the form believed they were
 * distinct, and silently merging them hides the misunderstanding.
 */
export const stakeholdersSchema = z
  .array(stakeholderSchema)
  .max(MAX_STAKEHOLDERS)
  .superRefine((stakeholders, ctx) => {
    const seen = new Set<string>();

    stakeholders.forEach((stakeholder, index) => {
      const key = `${stakeholder.audience}:${stakeholder.role.toLowerCase()}`;

      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Questo portatore di interesse è già presente con lo stesso pubblico.",
          path: [index],
        });
      }

      seen.add(key);
    });
  });

/**
 * Scoped to the project, not to the agent: the way a team works survives the
 * suspension of its Scrum Master AI, and outlives the question of whether an
 * agent can be deleted (spec Q7). One context per project, enforced by a unique
 * constraint in the database, which a schema cannot express.
 */
export const projectContextSchema = z.object({
  id: projectContextIdSchema,
  ...projectScopedFields,

  sprintLengthDays: sprintLengthDaysSchema,
  ceremonies: ceremonyScheduleSchema,
  definitionOfDone: definitionOfDoneSchema,
  workingAgreement: workingAgreementSchema,
  stakeholders: stakeholdersSchema,

  ...auditFields,
});

export type ProjectContext = z.infer<typeof projectContextSchema>;

/**
 * What step 2 of the wizard supplies.
 *
 * Every field carries its default, so an empty payload parses into exactly the
 * values the spec requires from a wizard completed without typing anything
 * (criterio 8). Identifier, tenant and project are excluded: the tenant comes
 * from the session and the project from the address, never from the body —
 * the same rule as `createProjectInputSchema`.
 */
export const createProjectContextInputSchema = z.object({
  sprintLengthDays: sprintLengthDaysSchema.default(DEFAULT_SPRINT_LENGTH_DAYS),
  ceremonies: ceremonyScheduleSchema.default(UNSCHEDULED_CEREMONIES),
  definitionOfDone: definitionOfDoneSchema.default([]),
  workingAgreement: workingAgreementSchema.default(null),
  stakeholders: stakeholdersSchema.default([]),
});

export type CreateProjectContextInput = z.infer<typeof createProjectContextInputSchema>;

/**
 * A section of the card being saved.
 *
 * `expectedUpdatedAt` is required even though every other field is optional: it
 * is the version the editor was looking at. Without it the second of two
 * concurrent saves overwrites the first in silence, and the spec asks for a
 * conflict instead.
 */
export const updateProjectContextInputSchema = projectContextSchema
  .pick({
    sprintLengthDays: true,
    ceremonies: true,
    definitionOfDone: true,
    workingAgreement: true,
    stakeholders: true,
  })
  .partial()
  .extend({ expectedUpdatedAt: timestampSchema });

export type UpdateProjectContextInput = z.infer<typeof updateProjectContextInputSchema>;
