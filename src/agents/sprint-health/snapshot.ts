import type { CitableValue, HealthSignalId } from "@/domain";
import type { HealthSignal, HealthStatus, SprintHealth } from "@/metrics";
import { formatNumber, formatPercent } from "@/lib/format";
import { SIGNAL_TITLES, VERDICT_WORDS } from "@/lib/health-words";

/**
 * Turning a computed verdict into the material a narration is written from.
 *
 * **Every number is written out here, by the code**, for the same reason the
 * sprint report does it: handing a model `0.62` leaves rounding, unit and
 * decimal separator to it, and a narration that rounds differently from the
 * banner above it destroys the reader's ability to check either.
 *
 * What is deliberately *not* passed to the model is the sentence the dashboard
 * already shows for each signal. Given a finished sentence a model paraphrases
 * it, which spends tokens to produce a worse version of something that was
 * already right. It receives the facts; the prose is its own job.
 */

/** The two figures a signal carries, already written. `null` when unmeasured. */
type Figures = {
  readonly measured: string | null;
  readonly threshold: string | null;
};

/**
 * How each signal's numbers are written.
 *
 * The units differ per signal and are not interchangeable: four of them are
 * proportions and two are multiples of a reference. Writing a multiple as a
 * percentage would turn «due volte l'abitudine» into «200% dell'abitudine»,
 * which reads as a different claim to most people.
 */
function figuresOf(signal: HealthSignal): Figures {
  const asPercent = (value: number | null): string | null =>
    value === null ? null : formatPercent(value);

  const asTimes = (value: number | null): string | null =>
    value === null ? null : `${formatNumber(value, 1)}×`;

  switch (signal.id) {
    case "progress":
    case "scope-added":
    case "aging":
    case "unowned":
      return { measured: asPercent(signal.measured), threshold: asPercent(signal.threshold) };

    case "review-wait":
    case "wip-limit":
      return { measured: asTimes(signal.measured), threshold: asTimes(signal.threshold) };
  }
}

export type SignalFacts = {
  readonly id: HealthSignalId;
  readonly title: string;
  readonly status: HealthStatus;
  readonly measured: string | null;
  readonly threshold: string | null;
  /** What was missing. Present exactly when the signal could not be evaluated. */
  readonly missing: string | null;
};

/** One earlier verdict, as a date and a word. */
export type HistoryPoint = {
  readonly date: string;
  readonly verdictLabel: string;
};

export type HealthSnapshot = {
  readonly sprintName: string;
  readonly verdict: HealthStatus;
  /** The verdict in the same words the dashboard prints beside this text. */
  readonly verdictLabel: string;
  readonly verdictSummary: string;
  readonly elapsed: string;
  readonly signals: readonly SignalFacts[];
  /**
   * Earlier verdicts, oldest first.
   *
   * Empty when the scheduled check has never run for this sprint — and that
   * emptiness is enforced downstream, because a model asked "how has this
   * changed" with nothing to compare will invent a change.
   */
  readonly history: readonly HistoryPoint[];
  /** Every figure the narration is allowed to quote. */
  readonly values: readonly CitableValue[];
};

export function buildHealthSnapshot(input: {
  readonly sprintName: string;
  readonly health: SprintHealth;
  readonly history: readonly HistoryPoint[];
}): HealthSnapshot {
  const values: CitableValue[] = [];
  const signals: SignalFacts[] = [];

  const elapsed = formatPercent(input.health.elapsedFraction);
  values.push({
    metricId: "sprint-elapsed",
    label: "Quota di sprint trascorsa",
    text: elapsed,
  });

  for (const signal of input.health.signals) {
    const figures = figuresOf(signal);
    const title = SIGNAL_TITLES[signal.id];

    signals.push({
      id: signal.id,
      title,
      status: signal.status,
      measured: figures.measured,
      threshold: figures.threshold,
      missing: signal.missing,
    });

    /*
     * A signal that could not be evaluated contributes no quotable figure.
     *
     * Its `measured` is null precisely because nothing was measured; admitting
     * a figure for it would be admitting one nobody computed.
     */
    if (figures.measured !== null) {
      values.push({
        metricId: signal.metricId,
        label: `${title} — misurato`,
        text: figures.measured,
      });
    }

    if (figures.threshold !== null) {
      values.push({
        metricId: signal.metricId,
        label: `${title} — soglia`,
        text: figures.threshold,
      });
    }
  }

  return {
    sprintName: input.sprintName,
    verdict: input.health.verdict,
    verdictLabel: VERDICT_WORDS[input.health.verdict].label,
    verdictSummary: VERDICT_WORDS[input.health.verdict].summary,
    elapsed,
    signals,
    history: input.history,
    values,
  };
}

/**
 * Whether there is anything worth asking a model about.
 *
 * A verdict of «non valutabile» means the code could not judge; asking for a
 * narration of a non-judgement spends tokens to be told what is already known,
 * and invites prose that sounds like a judgement anyway. The same applies when
 * no signal at all could be measured.
 */
export function isNarratable(snapshot: HealthSnapshot): boolean {
  if (snapshot.verdict === "not-evaluable") return false;

  return snapshot.signals.some((signal) => signal.status !== "not-evaluable");
}
