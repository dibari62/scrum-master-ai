import type {
  CitableValue,
  DataGap,
  DataGapReason,
  EvidenceItem,
  MetricSnapshot,
} from "@/domain";
import type { CarryOver, EstimateTotals, FlowSummary, MetricResult, ScopeChange } from "@/metrics";
import { formatDuration, formatEstimate, formatNumber, formatPercent } from "@/lib/format";

/**
 * Turns computed metrics into the two lists a report is built from: the figures
 * the model may quote, and the ones that do not exist.
 *
 * **Every number is written out here, by the code.** The model receives strings,
 * never quantities. Handing over `2.8` would leave the rounding, the unit and
 * the decimal separator to it — three more chances to produce a figure that
 * disagrees with the dashboard, and a disagreement between the two is worse than
 * either being wrong alone, because it destroys the reader's ability to check.
 *
 * The formatters are the *same* ones the dashboard uses. That is not tidiness:
 * it is what makes "identical to the dashboard" true rather than intended.
 */

/** The reason in words, so the model relays a fact instead of composing one. */
const GAP_EXPLANATIONS: Readonly<Record<DataGapReason, string>> = {
  "no-data": "non ci sono dati da cui calcolarla",
  "no-qualifying-data": "nessun elemento soddisfa le condizioni per calcolarla",
  "empty-denominator": "il denominatore sarebbe zero: sarebbe una media su nulla",
  "mixed-estimate-units": "le stime sono in unità diverse e non vanno sommate",
};

function gap(metricId: string, label: string, reason: DataGapReason): DataGap {
  return { metricId, label, reason, explanation: GAP_EXPLANATIONS[reason] };
}

/**
 * Appends either a value or a gap, never neither and never both.
 *
 * The whole translation from `MetricResult` to the report lives in this one
 * place. Spread across call sites it would eventually be written as
 * `result.available ? … : "0"` by somebody in a hurry, which is the exact
 * failure `MetricResult` was created to make impossible.
 */
function push(
  target: { values: CitableValue[]; gaps: DataGap[] },
  metricId: string,
  label: string,
  result: MetricResult<number>,
  render: (value: number) => string,
): void {
  if (result.available) {
    target.values.push({ metricId, label, text: render(result.value) });
  } else {
    target.gaps.push(gap(metricId, label, result.reason));
  }
}

/**
 * Velocity, written with its unit and never as one number.
 *
 * Points and hours are reported separately because summing them produces a
 * figure that means nothing, and no chart or sentence downstream could detect
 * that it had happened.
 */
function velocityValues(
  result: MetricResult<EstimateTotals>,
  target: { values: CitableValue[]; gaps: DataGap[] },
): void {
  if (!result.available) {
    target.gaps.push(gap("velocity", "Velocity", result.reason));
    return;
  }

  const totals = result.value;

  /*
   * The count is emitted first, and whatever happens to the estimates.
   *
   * How many items were finished stays true even when their estimates cannot be
   * summed — mixed units make the *total* meaningless, not the tally. An earlier
   * version returned early on mixed units and lost the count, so a sprint that
   * had closed eight items reported nothing at all about them.
   */
  target.values.push({
    metricId: "velocity",
    label: "Elementi conclusi nello sprint",
    text: `${formatNumber(result.sampleSize)} elementi`,
  });

  if (totals.mixed) {
    target.gaps.push(gap("velocity", "Velocity", "mixed-estimate-units"));
    return;
  }

  if (totals.points !== null) {
    target.values.push({
      metricId: "velocity",
      label: "Velocity",
      text: formatEstimate(totals.points, "points"),
    });
    return;
  }

  if (totals.hours !== null) {
    target.values.push({
      metricId: "velocity",
      label: "Velocity",
      text: formatEstimate(totals.hours, "hours"),
    });
    return;
  }

  // Work was done but nobody estimated it. That is a legitimate way to run a
  // team, not a failure, and the report says so rather than showing zero.
  target.gaps.push(gap("velocity", "Velocity", "no-qualifying-data"));
}

export type SnapshotInput = {
  readonly sprintId: string;
  readonly sprintName: string;
  readonly takenAt: Date;
  readonly flow: FlowSummary;
  readonly velocity: MetricResult<EstimateTotals>;
  readonly scopeChange: MetricResult<ScopeChange>;
  readonly carryOver: MetricResult<CarryOver>;
  readonly throughput: MetricResult<number>;
  readonly evidence: readonly EvidenceItem[];
  readonly evidenceTruncated: boolean;
};

export function buildSnapshot(input: SnapshotInput): MetricSnapshot {
  const target = { values: [] as CitableValue[], gaps: [] as DataGap[] };

  velocityValues(input.velocity, target);

  push(target, "throughput", "Elementi conclusi", input.throughput, (n) =>
    `${formatNumber(n)} elementi`,
  );

  push(target, "cycle-time", "Cycle time mediano", input.flow.cycleTime.median, formatDuration);
  push(target, "cycle-time", "Cycle time all'85°", input.flow.cycleTime.p85, formatDuration);
  push(target, "lead-time", "Lead time mediano", input.flow.leadTime.median, formatDuration);
  push(
    target,
    "review-wait",
    "Attesa in revisione mediana",
    input.flow.reviewWait.median,
    formatDuration,
  );
  push(
    target,
    "flow-efficiency",
    "Efficienza di flusso mediana",
    input.flow.flowEfficiency.median,
    (ratio) => formatPercent(ratio, 0),
  );
  push(target, "reopen-rate", "Tasso di riapertura", input.flow.reopenRate, (ratio) =>
    formatPercent(ratio, 1),
  );

  if (input.scopeChange.available) {
    const change = input.scopeChange.value;
    target.values.push({
      metricId: "scope-change",
      label: "Lavoro aggiunto dopo l'inizio",
      text: `${formatNumber(change.addedCount)} elementi`,
    });
    target.values.push({
      metricId: "scope-change",
      label: "Lavoro rimosso dopo l'inizio",
      text: `${formatNumber(change.removedCount)} elementi`,
    });
  } else {
    target.gaps.push(gap("scope-change", "Cambio di perimetro", input.scopeChange.reason));
  }

  if (input.carryOver.available) {
    target.values.push({
      metricId: "carry-over",
      label: "Lavoro trascinato",
      text: `${formatNumber(input.carryOver.value.items.length)} elementi`,
    });
  } else {
    target.gaps.push(gap("carry-over", "Lavoro trascinato", input.carryOver.reason));
  }

  return {
    sprintId: input.sprintId,
    sprintName: input.sprintName,
    takenAt: input.takenAt,
    values: target.values,
    gaps: target.gaps,
    evidence: input.evidence,
    evidenceTruncated: input.evidenceTruncated,
  };
}

/**
 * Whether there is anything worth asking a model to narrate.
 *
 * With no figures at all, calling one would spend tokens to be told there is
 * nothing to say, and would present as generated a sentence the code could write
 * itself (spec §4, percorso alternativo).
 */
export function hasNarratableContent(snapshot: MetricSnapshot): boolean {
  return snapshot.values.length > 0;
}
