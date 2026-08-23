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
 */

/** What the number is measured in, so a reader knows what "6,6" means. */
export const metricUnitSchema = z.enum([
  "duration",
  "count",
  "ratio",
  "points",
  "items-per-sprint",
]);

export type MetricUnit = z.infer<typeof metricUnitSchema>;

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

export const metricCatalogSchema = z.array(metricDefinitionSchema).readonly();

export type MetricCatalog = z.infer<typeof metricCatalogSchema>;
