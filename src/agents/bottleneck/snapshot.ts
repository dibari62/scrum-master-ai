import type { CitableValue, WorkItemState } from "@/domain";
import type { Bottleneck, FlowStage } from "@/metrics";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { STATE_LABELS } from "@/lib/state-words";

/**
 * Turning the measured flow into the material a narration is written from.
 *
 * Every number is written out here by the code, with the same formatters the
 * flow page uses — which is what makes «identical to the table beside it» true
 * rather than intended.
 */

export type StageFacts = {
  readonly state: WorkItemState;
  readonly label: string;
  /** This phase's share of all measured time, already written. */
  readonly share: string;
  readonly total: string;
  /** The middle length of a single stay, or `null` when not computable. */
  readonly median: string | null;
  readonly itemCount: number;
  /** Whether somebody is working during it, as the domain defines it. */
  readonly valueAdding: boolean;
};

export type BottleneckSnapshot = {
  readonly projectName: string;
  readonly stages: readonly StageFacts[];
  /**
   * The waiting phase the engine picked, or `null`.
   *
   * `null` is not «none found yet»: it means nothing waited, and a narration
   * that names one anyway is refused.
   */
  readonly worstWait: StageFacts | null;
  readonly valueAddingShare: string;
  readonly values: readonly CitableValue[];
};

function factsOf(stage: FlowStage): StageFacts {
  return {
    state: stage.state,
    label: STATE_LABELS[stage.state],
    share: formatPercent(stage.share),
    total: formatDuration(stage.totalMs),
    median: stage.medianMs.available ? formatDuration(stage.medianMs.value) : null,
    itemCount: stage.itemCount,
    valueAdding: stage.valueAdding,
  };
}

export function buildBottleneckSnapshot(input: {
  readonly projectName: string;
  readonly bottleneck: Bottleneck;
}): BottleneckSnapshot {
  const stages = input.bottleneck.stages.map(factsOf);
  const values: CitableValue[] = [];

  values.push({
    metricId: "value-adding-share",
    label: "Quota di tempo in lavorazione",
    text: formatPercent(input.bottleneck.valueAddingShare),
  });

  for (const stage of stages) {
    values.push({
      metricId: `stage-share-${stage.state}`,
      label: `${stage.label} — quota di tempo`,
      text: stage.share,
    });

    values.push({
      metricId: `stage-total-${stage.state}`,
      label: `${stage.label} — tempo totale`,
      text: stage.total,
    });

    if (stage.median !== null) {
      values.push({
        metricId: `stage-median-${stage.state}`,
        label: `${stage.label} — durata mediana di una sosta`,
        text: stage.median,
      });
    }

    values.push({
      metricId: `stage-items-${stage.state}`,
      label: `${stage.label} — elementi transitati`,
      text: `${formatNumber(stage.itemCount)} ${stage.itemCount === 1 ? "elemento" : "elementi"}`,
    });
  }

  const worst = input.bottleneck.worstWait;

  return {
    projectName: input.projectName,
    stages,
    worstWait: worst === null ? null : factsOf(worst),
    valueAddingShare: formatPercent(input.bottleneck.valueAddingShare),
    values,
  };
}

/** Whether there is a flow worth describing at all. */
export function hasFlowToDescribe(snapshot: BottleneckSnapshot): boolean {
  return snapshot.stages.length > 0;
}
