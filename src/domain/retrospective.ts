import { z } from "zod";

import { auditFields, descriptionSchema, projectScopedFields, timestampSchema } from "./common";
import {
  improvementActionIdSchema,
  retrospectiveIdSchema,
  retrospectiveNoteIdSchema,
  sprintIdSchema,
} from "./ids";

/**
 * The sprint retrospective, and what it decides.
 *
 * **Why it needed to exist.** Four of the five Scrum events already left a mark
 * in this product: planning produces a forecast, the daily produces a digest,
 * the review closes a sprint. The retrospective was schedulable in the ceremony
 * calendar and produced **nothing** — so the one meeting whose entire purpose is
 * to change how the team works could not be shown to have changed anything.
 *
 * The book is blunt about why that matters: «Focus on just a few improvements
 * per sprint» is advice that only means something if somebody later checks
 * whether those few actually happened (pag. 87).
 *
 * **The three columns are the book's, verbatim** (pag. 86):
 *
 * > **Good**: If we could redo the same sprint again, we would do these things
 * > the same way.
 * > **Could have done better**: … we would do these things differently.
 * > **Improvements**: Concrete ideas about how we could improve in the future.
 *
 * > «So columns one and two look into the past, while column three looks into
 * > the future.»
 *
 * **What this deliberately does not model.** No mood, no sentiment, no "how did
 * the sprint feel". §8.2 forbids inferring emotional states of individuals in a
 * work context, and a retrospective is exactly where a well-meaning product
 * would start. The notes are what people *said*, recorded as text; nothing here
 * scores them.
 */

/**
 * Which column a note belongs to.
 *
 * Named after the book's own headings rather than a generic
 * `positive`/`negative`: «could have done better» is not the negative of
 * «good», it is a different question — one asks what to repeat, the other what
 * to change — and collapsing them into a polarity would lose the distinction
 * that makes the exercise useful.
 */
export const retrospectiveColumnSchema = z.enum([
  "good",
  "could-have-done-better",
  "improvement",
]);

export type RetrospectiveColumn = z.infer<typeof retrospectiveColumnSchema>;

export const MAX_NOTE_LENGTH = 500;

/**
 * One thing somebody said, on one of the three columns.
 *
 * **Untrusted content** (§8.1): written by a person, and it will sit next to a
 * prompt the day a skill summarises a retrospective. It is data, never
 * instruction.
 *
 * **There is no author field, and that is the point.** The book's format is a
 * wall of anonymous Post-its; attaching a name would turn «what could have gone
 * better» into a record of who complained, which is the fastest way to make a
 * team stop saying anything. It would also put a per-person count one query
 * away.
 */
export const retrospectiveNoteSchema = z.object({
  id: retrospectiveNoteIdSchema,
  ...projectScopedFields,

  retrospectiveId: retrospectiveIdSchema,
  column: retrospectiveColumnSchema,
  text: z.string().trim().min(1).max(MAX_NOTE_LENGTH),

  ...auditFields,
});

export type RetrospectiveNote = z.infer<typeof retrospectiveNoteSchema>;

/**
 * How many votes each participant may distribute.
 *
 * > «Each team member was given **three magnets** and invited to vote on
 * > whatever improvements they would like the team to prioritize during next
 * > sprint. Each team member could distribute the magnets as they like, even
 * > placing all three on a single issue.» (pag. 87)
 */
export const VOTES_PER_PARTICIPANT = 3;

/**
 * The minimum number of participants below which votes are not shown.
 *
 * §8.2 in practice: with two people in the room, a total of four votes on an
 * item tells you almost exactly how each of them voted. The aggregate stops
 * being an aggregate. Three is the smallest group where a total genuinely hides
 * the individuals behind it.
 */
export const MIN_PARTICIPANTS_FOR_VOTES = 3;

/**
 * Where an improvement stands when the next retrospective looks at it.
 *
 * `dropped` is a first-class outcome and not a failure. The book explicitly
 * allows deciding to do nothing — «in many cases, just identifying a problem
 * clearly is enough for it to solve itself» (pag. 88) — and a product that only
 * offered "done" or "not done" would push teams to claim the first.
 */
export const improvementStatusSchema = z.enum(["open", "done", "dropped"]);

export type ImprovementStatus = z.infer<typeof improvementStatusSchema>;

export const improvementActionSchema = z.object({
  id: improvementActionIdSchema,
  ...projectScopedFields,

  /** The retrospective that decided it. */
  retrospectiveId: retrospectiveIdSchema,

  title: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
  detail: descriptionSchema,

  /**
   * Votes received, as a **total**.
   *
   * Never a list of voters, for the same reason a note has no author. The count
   * is what ordered the wall; who put which magnet where was never recorded,
   * not even on the whiteboard.
   */
  votes: z.number().int().min(0),

  status: improvementStatusSchema,

  /**
   * When the outcome was recorded, `null` while still open.
   *
   * Separate from `updatedAt`: that moves whenever anything changes, including
   * a typo in the title. This is the moment somebody decided the improvement
   * had landed — the only instant from which "how long did it take" can be
   * measured.
   */
  resolvedAt: timestampSchema.nullable(),

  ...auditFields,
});

export type ImprovementAction = z.infer<typeof improvementActionSchema>;

export const retrospectiveSchema = z.object({
  id: retrospectiveIdSchema,
  ...projectScopedFields,

  /** The sprint being looked back on. One retrospective per sprint. */
  sprintId: sprintIdSchema,

  heldAt: timestampSchema,

  /**
   * How many people took part.
   *
   * A count, never a roster — the same rule as `SprintStatistics.teamSize`. It
   * exists for one purpose: deciding whether the vote totals may be shown at
   * all (`MIN_PARTICIPANTS_FOR_VOTES`).
   */
  participantCount: z.number().int().min(0),

  ...auditFields,
});

export type Retrospective = z.infer<typeof retrospectiveSchema>;

/**
 * True when vote totals are safe to show for this retrospective.
 *
 * A function rather than a comparison scattered at each call site: it is a rule
 * from §8.2, and a rule that is re-derived in three places is a rule that will
 * eventually be derived differently in one of them.
 */
export function mayShowVotes(retrospective: Retrospective): boolean {
  return retrospective.participantCount >= MIN_PARTICIPANTS_FOR_VOTES;
}
