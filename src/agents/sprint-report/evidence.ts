import type { EvidenceItem, EvidenceReason } from "@/domain";
import type { StateTransition, WorkItem, WorkItemId } from "@/domain";
import { cycleTime, groupByWorkItem, reopenCount, reviewWaitTime } from "@/metrics";

/**
 * Which work items are put in front of the model, and why.
 *
 * **The model does not choose.** §9 requires a deterministic pre-filter: the
 * code picks the forty items that matter and hands those over, rather than
 * shipping the whole sprint and hoping attention lands in the right place. That
 * is partly about cost, but mostly about repeatability — a selection made by a
 * model is a selection nobody can reproduce or argue with.
 *
 * Each item carries the reason it was chosen. The reason is a calculated fact,
 * so the selection can be checked without reading the prompt.
 */

/**
 * Ceiling on how much evidence reaches the model (`AGENTS.md` §9).
 *
 * Forty is the figure the rules name. What matters more than the number is that
 * exceeding it **cuts** rather than quietly widening the budget, and that the
 * report says it was cut.
 */
export const MAX_EVIDENCE_ITEMS = 40;

/**
 * Priority order. Earlier reasons survive truncation.
 *
 * Carry-over and mid-sprint additions come first because they are the two things
 * a stakeholder asks about unprompted: what did not get done, and what changed
 * after we agreed. The three flow signals follow, being diagnosis rather than
 * outcome.
 */
const REASON_ORDER: readonly EvidenceReason[] = [
  "carry-over",
  "mid-sprint-addition",
  "reopened",
  "long-review-wait",
  "long-cycle-time",
];

export type EvidenceInput = {
  readonly items: readonly WorkItem[];
  readonly transitions: readonly StateTransition[];
  /** Items unfinished at the sprint's close, from `carryOver`. */
  readonly carriedOver: ReadonlySet<WorkItemId>;
  /** Items that entered after the sprint began, from `scopeChange`. */
  readonly addedMidSprint: ReadonlySet<WorkItemId>;
  /** Above this, a review wait is worth showing. From the project distribution. */
  readonly reviewWaitThresholdMs: number | null;
  /** Above this, a cycle time is worth showing. From the project distribution. */
  readonly cycleTimeThresholdMs: number | null;
  readonly asOf: Date;
};

export type EvidenceSelection = {
  readonly items: readonly EvidenceItem[];
  /** True when the ceiling was reached and material was dropped. */
  readonly truncated: boolean;
};

/**
 * The single reason an item is shown, highest priority first.
 *
 * An item can qualify several ways — carried over *and* reopened — and listing
 * it twice would let one item take two of the forty places while looking like
 * two problems.
 */
function reasonFor(
  item: WorkItem,
  history: readonly StateTransition[],
  input: EvidenceInput,
): EvidenceReason | null {
  const id = item.id as WorkItemId;

  if (input.carriedOver.has(id)) return "carry-over";
  if (input.addedMidSprint.has(id)) return "mid-sprint-addition";
  if (reopenCount(history) > 0) return "reopened";

  if (input.reviewWaitThresholdMs !== null) {
    const wait = reviewWaitTime(history, input.asOf);
    if (wait.available && wait.value > input.reviewWaitThresholdMs) return "long-review-wait";
  }

  if (input.cycleTimeThresholdMs !== null) {
    const cycle = cycleTime(history);
    if (cycle.available && cycle.value > input.cycleTimeThresholdMs) return "long-cycle-time";
  }

  return null;
}

export function selectEvidence(input: EvidenceInput): EvidenceSelection {
  const byItem = groupByWorkItem(input.transitions);
  const selected: EvidenceItem[] = [];

  for (const item of input.items) {
    /*
     * History is cut at `asOf` before anything is asked of it.
     *
     * Without this a report on a sprint that closed in August would see a
     * reopening that happened in September and call the item «riaperto» — true
     * later, false at the moment being reported on. A report describes an
     * instant, and evidence from after that instant is not evidence.
     */
    const history = (byItem.get(item.id as WorkItemId) ?? []).filter(
      (transition) => transition.occurredAt.getTime() <= input.asOf.getTime(),
    );

    const reason = reasonFor(item, history, input);
    if (!reason) continue;

    selected.push({ workItemId: item.id, title: item.title, reason });
  }

  /*
   * Priority first, then identifier.
   *
   * The tie-break is not decoration. With more items of one reason than the
   * ceiling admits, the ones that survive would otherwise depend on the order
   * the rows arrived in, and two reports on the same sprint would disagree about
   * which items mattered.
   */
  selected.sort((a, b) => {
    const byReason = REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason);
    return byReason !== 0 ? byReason : a.workItemId.localeCompare(b.workItemId);
  });

  return {
    items: selected.slice(0, MAX_EVIDENCE_ITEMS),
    truncated: selected.length > MAX_EVIDENCE_ITEMS,
  };
}
