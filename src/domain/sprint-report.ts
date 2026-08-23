import { z } from "zod";

/**
 * Contracts for the sprint report: the first output a language model writes in
 * this product (specs/sprint-report/spec.md).
 *
 * **The idea these types exist to enforce.** R1 says the code calculates and the
 * model narrates. Everywhere else that rule is respected by construction — a
 * model is simply never asked for a number. Here it cannot be, because the model
 * writes prose *containing* numbers, and prose is where an invented figure hides
 * best.
 *
 * So the numbers are handed over as a **closed set of already-formatted
 * strings** (`CitableValue`), and the finished text is checked against it. A
 * figure in the report that is not in the set was either invented or computed by
 * the model, and both are refusals. That turns "do not calculate" from an
 * instruction the model may ignore into a property a machine can decide.
 */

/** Identifies which catalogue metric a value or a gap comes from. */
export const metricIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*$/);

/**
 * A number the model is allowed to quote, already written out by the code.
 *
 * `text` is the whole point: "2,8 giorni", not `2.8`. Handing over a raw number
 * would leave the rounding, the unit and the decimal separator to the model —
 * three more chances to produce something that disagrees with the dashboard.
 */
export const citableValueSchema = z.object({
  metricId: metricIdSchema,
  /** How the value is named to a reader, e.g. «Cycle time mediano». */
  label: z.string().min(1),
  /** The exact string the model may reproduce, unit included. */
  text: z.string().min(1),
});

export type CitableValue = z.infer<typeof citableValueSchema>;

/**
 * Why a metric is absent, stated rather than silently rendered as zero.
 *
 * Mirrors `UnavailableReason` in `src/metrics`. It is repeated as a Zod enum
 * instead of imported because `domain` depends on nothing (§4); the metrics test
 * suite checks the two stay aligned.
 */
export const dataGapReasonSchema = z.enum([
  "no-data",
  "no-qualifying-data",
  "empty-denominator",
  "mixed-estimate-units",
]);

export type DataGapReason = z.infer<typeof dataGapReasonSchema>;

export const dataGapSchema = z.object({
  metricId: metricIdSchema,
  label: z.string().min(1),
  reason: dataGapReasonSchema,
  /** The reason in words, written by the code, for the model to relay. */
  explanation: z.string().min(1),
});

export type DataGap = z.infer<typeof dataGapSchema>;

/**
 * Why an item was put in front of the model.
 *
 * A closed set written by the code. The reason is a calculated fact, not an
 * interpretation, and keeping it explicit means the selection can be checked
 * without reading the prompt.
 */
export const evidenceReasonSchema = z.enum([
  "carry-over",
  "mid-sprint-addition",
  "reopened",
  "long-review-wait",
  "long-cycle-time",
]);

export type EvidenceReason = z.infer<typeof evidenceReasonSchema>;

/**
 * One item shown to the model as untrusted material.
 *
 * `title` arrives from an external tool and may contain anything, instructions
 * included. It travels inside an untrusted block and is never concatenated into
 * the system prompt (§8.1).
 */
export const evidenceItemSchema = z.object({
  workItemId: z.string().min(1),
  title: z.string(),
  reason: evidenceReasonSchema,
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

/**
 * Everything the report rests on, frozen at the moment it was produced.
 *
 * Stored with the report rather than recomputed on reading. A report reread in
 * three months has to keep saying the same numbers; recalculating them would let
 * them change under the reader, which is the one thing a written report must
 * never do.
 */
export const metricSnapshotSchema = z.object({
  sprintId: z.string().min(1),
  sprintName: z.string().min(1),
  takenAt: z.coerce.date(),
  values: z.array(citableValueSchema).readonly(),
  gaps: z.array(dataGapSchema).readonly(),
  evidence: z.array(evidenceItemSchema).readonly(),
  /** True when the evidence hit the ceiling and was cut (spec criterio 15). */
  evidenceTruncated: z.boolean(),
});

export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;

/**
 * An observation about the process, anchored to a metric that exists.
 *
 * Distinct from `Insight`, which is T5 and carries confidence and a suggested
 * action. Confusing the two would slide the agent from «riferisce» to
 * «consiglia» without anyone deciding it (spec §11 Q2).
 */
export const attentionPointSchema = z.object({
  metricId: metricIdSchema,
  observation: z.string().min(20),
});

export type AttentionPoint = z.infer<typeof attentionPointSchema>;

/**
 * Who wrote the prose.
 *
 * A report on an empty sprint is legitimate but was not written by a model.
 * Saying so keeps a demonstration from appearing to use AI where it does not.
 */
export const reportOriginSchema = z.enum(["model", "code"]);

export type ReportOrigin = z.infer<typeof reportOriginSchema>;

/**
 * The shape the model must return.
 *
 * Minimum lengths are a blunt instrument and worth naming as such: they count
 * characters, not meaning. They exist to separate a silent failure — three words
 * that satisfy every type — from a real answer (spec §11 Q5).
 */
export const reportContentSchema = z.object({
  /** What happened, for someone who has not seen the dashboard. */
  summary: z.string().min(80).max(1200),
  /** How the work flowed: durations, waiting, rework. */
  flow: z.string().min(80).max(1200),
  /**
   * At most five. A report that flags everything flags nothing, and the cap
   * forces the model to choose rather than to enumerate.
   */
  attentionPoints: z.array(attentionPointSchema).max(5).readonly(),
});

export type ReportContent = z.infer<typeof reportContentSchema>;

export const sprintReportSchema = z.object({
  origin: reportOriginSchema,
  content: reportContentSchema,
  snapshot: metricSnapshotSchema,
});

export type SprintReport = z.infer<typeof sprintReportSchema>;
