import { z } from "zod";

/**
 * The catalogue of metrics: what each number means and how it is produced.
 *
 * **Why this is data and not a page of prose.** A written explanation of a
 * calculation is a copy of it, and copies drift: the code changes, the page
 * keeps describing what the code used to do, and the reader is worse off than
 * with no page at all — they now have a confident wrong answer.
 *
 * So the catalogue is a validated structure that names, for every metric, the
 * file that computes it and the file that tests it. A test walks the metrics
 * engine and fails when an exported metric has no entry here, which is what
 * stops the two from parting company.
 *
 * `formula` is deliberately words rather than notation. The reader this is for
 * wants to know *what is being counted and what is being left out*; `p85(Σ…)`
 * answers a different question, asked by someone who already knows the answer.
 *
 * **Two different questions, two different pages.** `formula`, `question` and
 * `excludes` answer «what does this number mean». The fields added below answer
 * «where does it come from»: which canonical entities are read, between which
 * two instants, with which arithmetic, and what happens in the awkward cases.
 * They are structured rather than prose so a test can hold them against the
 * engine — an explanation nobody can check is the kind of documentation this
 * project decided not to have.
 */

/** What the number is measured in, so a reader knows what "6,6" means. */
export const metricUnitSchema = z.enum([
  "duration",
  "count",
  "ratio",
  "points",
  "items-per-sprint",
  /**
   * Not a quantity at all, but a graded judgement: serene, watch, critical.
   *
   * Added rather than forced into `ratio` because the difference is the whole
   * point. A ratio can be averaged, compared and plotted over time; a verdict
   * cannot, and the moment one is treated as the other somebody computes the
   * "average health" of four sprints and reports a number that means nothing.
   */
  "verdict",
]);

export type MetricUnit = z.infer<typeof metricUnitSchema>;

/**
 * The canonical entities a metric may read.
 *
 * A closed list, and every value is checked by `catalog.test.ts` against the
 * types actually exported by `src/domain` *and* against the signature of the
 * function that computes the metric. A metric that quietly starts reading
 * something else — or stops reading something it declares — fails the build.
 *
 * `WorkItem.state` is deliberately not among the things a metric reads: the
 * current state says where an item is now, and no past figure can be rebuilt
 * from it (ADR-0002).
 */
export const metricInputEntitySchema = z.enum([
  "WorkItem",
  "StateTransition",
  "EstimateChange",
  "WorkingCalendar",
  "TeamMemberAvailability",
  "ImprovementAction",
  "Sprint",
  "SprintScopeEvent",
]);

export type MetricInputEntity = z.infer<typeof metricInputEntitySchema>;

export const metricInputSchema = z.object({
  entity: metricInputEntitySchema,
  /** Which part of the entity is read, and what for. */
  reads: z.string().min(1),
});

export type MetricInput = z.infer<typeof metricInputSchema>;

/**
 * The arithmetic applied once the data has been selected.
 *
 * Naming the operation separately from the prose formula is what lets a reader
 * see, at a glance, that velocity is a sum while throughput is a count — a
 * distinction that decides whether two teams' figures can be compared at all.
 */
export const metricOperationSchema = z.enum([
  /** How many things there are. */
  "count",
  /** Durations or estimates added together. */
  "sum",
  /** The time between two instants. */
  "elapsed",
  /** One quantity divided by another of the same kind. */
  "ratio",
  /** The middle value of a set, chosen when a mean would be dragged by outliers. */
  "median",
  /** The arithmetic average of a set. */
  "mean",
  /** A value sampled repeatedly over time. */
  "series",
  /**
   * The worst of several findings, deliberately not their average.
   *
   * Named as an operation of its own because "worst" is a decision with
   * consequences, not an implementation detail: an average lets three calm
   * signals bury one serious one, which is how an indicator becomes
   * decoration. Anything declaring this operation is promising not to do that.
   */
  "worst",
]);

export type MetricOperation = z.infer<typeof metricOperationSchema>;

/**
 * How per-item values are summarised when a whole set is shown.
 *
 * Flow data is skewed, so `summariseFlow` reports mean, median and 85th
 * percentile together rather than picking one. A metric that is computed one
 * item at a time and then aggregated has to say so, or the reader will take the
 * single-item definition for the number on the screen.
 */
export const metricAggregationSchema = z.enum(["mean", "median", "p85"]);

export type MetricAggregation = z.infer<typeof metricAggregationSchema>;

/**
 * The instants the measure is taken between, or at.
 *
 * The most frequent way to get a duration wrong is not the arithmetic, it is
 * the ends: measuring cycle time to the *last* completion instead of the first
 * turns rework into slowness. So the ends are a field, said in full, and never
 * left to be inferred from the prose.
 */
export const metricObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("between"),
    /** The instant the measure starts from, said exactly. */
    from: z.string().min(1),
    /** The instant it runs to, said exactly. */
    to: z.string().min(1),
  }),
  z.object({
    kind: z.literal("at"),
    /** The single instant the world is looked at. */
    instant: z.string().min(1),
  }),
  z.object({
    kind: z.literal("history"),
    /** The stretch of history considered, when no instant bounds it. */
    over: z.string().min(1),
  }),
]);

export type MetricObservation = z.infer<typeof metricObservationSchema>;

/**
 * An awkward case and what the engine actually returns for it.
 *
 * `verifiedBy` names a test in `testFile`, and `catalog.test.ts` checks the
 * name is really there. That is the whole point: without it this list would be
 * a promise about behaviour, and promises about behaviour are what drift.
 */
export const metricEdgeCaseSchema = z.object({
  /** The situation, in the reader's terms. */
  situation: z.string().min(1),
  /** What comes out of it — a value, or a stated unavailability with its reason. */
  outcome: z.string().min(1),
  /** The title of the test that proves it, inside `testFile`. */
  verifiedBy: z.string().min(1),
});

export type MetricEdgeCase = z.infer<typeof metricEdgeCaseSchema>;

export const metricDefinitionSchema = z.object({
  /** Stable identifier, used to link a card on the dashboard to its entry. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "solo minuscole, cifre e trattini"),

  /** The label shown on the dashboard. Must match it, or the link is a riddle. */
  name: z.string().min(1),

  /** The question the metric answers, in one sentence. */
  question: z.string().min(1),

  /** How it is computed, in words: what is counted, from when to when. */
  formula: z.string().min(1),

  unit: metricUnitSchema,

  /**
   * What is deliberately left out.
   *
   * The most common way to misread a metric is not to misunderstand what it
   * counts but to assume it counts something it doesn't.
   */
  excludes: z.array(z.string().min(1)).readonly(),

  /** When the metric cannot be produced at all, rather than being zero. */
  unavailableWhen: z.string().min(1),

  /**
   * The canonical entities the calculation starts from.
   *
   * At least one, because a metric with no input is not a measurement.
   */
  inputs: z.array(metricInputSchema).min(1).readonly(),

  /** Between which instants — or at which instant — the measure is taken. */
  observation: metricObservationSchema,

  /** The arithmetic applied to the selected data. */
  operation: metricOperationSchema,

  /**
   * How single-item values are combined when a set is shown.
   *
   * Empty for a metric that is already a figure about a whole set, such as
   * velocity or throughput.
   */
  summarisedBy: z.array(metricAggregationSchema).readonly(),

  /**
   * What the sample size that travels with the value actually counts.
   *
   * Every result carries one, and it does not always count the same thing: for
   * `sprintItemCount` it is the number of scope movements read, not the number
   * of items left. A reader who assumes the wrong one misjudges how much the
   * figure can be trusted.
   */
  sampleSizeMeaning: z.string().min(1),

  /**
   * How the reference instant reaches the function, or `null` when none is
   * needed. Never read from the clock (ADR-0002).
   */
  referenceInstant: z.string().min(1).nullable(),

  /** Awkward cases and what the engine really returns, each bound to a test. */
  edgeCases: z.array(metricEdgeCaseSchema).min(1).readonly(),

  /** A decision that shaped the definition, and where it is argued. */
  decision: z.string().min(1).optional(),

  /** Path, from the repository root, of the code that computes it. */
  sourceFile: z.string().min(1),

  /** The exported function inside `sourceFile`. */
  sourceSymbol: z.string().min(1),

  /** Path of the file that tests it. Checked to exist. */
  testFile: z.string().min(1),
});

export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;

/**
 * A definition whose parts agree with each other.
 *
 * Kept apart from `metricDefinitionSchema` for the same reason as
 * `validSprintSchema` in `sprint.ts`: a refined object loses `.pick()` and
 * `.partial()`, and the base shape has to stay composable.
 *
 * The one rule worth enforcing at load time is that a duration says between
 * which two instants it is measured. A duration with a single instant is not an
 * under-documented metric, it is an impossible one.
 *
 * **With one exception, and it is not a loophole.** A cumulative duration —
 * blocked time is the only one so far — is the sum of several stretches, so it
 * has no single pair of ends: naming one would be a lie chosen to satisfy a
 * validator. Such a metric declares `operation: "sum"` over `kind: "history"`,
 * which says exactly that, and nothing else is allowed to skip the ends.
 */
export const wellFormedMetricDefinitionSchema = metricDefinitionSchema.superRefine(
  (metric, ctx) => {
    if (metric.unit !== "duration") return;

    const isCumulative =
      metric.operation === "sum" && metric.observation.kind === "history";

    if (metric.observation.kind !== "between" && !isCumulative) {
      ctx.addIssue({
        code: "custom",
        path: ["observation"],
        message:
          "una durata deve dichiarare i due estremi fra cui è misurata (kind: \"between\"), " +
          "oppure essere una somma di tratti (operation: \"sum\" su kind: \"history\")",
      });
    }
  },
);

export const metricCatalogSchema = z.array(wellFormedMetricDefinitionSchema).readonly();

export type MetricCatalog = z.infer<typeof metricCatalogSchema>;
