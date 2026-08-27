import {
  type BoardColumn,
  type Sprint,
  type SprintScopeEvent,
  type StateTransition,
  type WorkItem,
  type WorkItemId,
  type WorkItemState,
} from "@/domain";

import { cycleTime, reviewWaitTime } from "./flow";
import { totalEstimates } from "./estimates";
import { groupByWorkItem, stateAt } from "./history";
import { available, median, percentile, unavailable, type MetricResult } from "./result";
import {
  membershipAt,
  unownedWorkInProgress,
  DEFAULT_UNOWNED_STUCK_AFTER_MS,
} from "./sprint";

/**
 * How the sprint that is still running is going.
 *
 * **The reason this exists.** Everything before it answered when asked: the
 * dashboard shows figures to whoever opens it, the report is produced by
 * pressing a button. What a Scrum Master actually does is notice that a sprint
 * is going wrong *while it can still be changed*. In this project's own
 * synthetic data, review wait climbed from a few hours to two and a half days
 * across four sprints and nobody noticed until a metric was built for it.
 *
 * **No model decides a colour.** The verdict is arithmetic over declared
 * thresholds, and R1 is the whole point: a judgement produced by a language
 * model would be unrepeatable, unarguable, and impossible to hold against the
 * numbers beside it. The model may narrate this; it cannot reach it.
 *
 * Pure and I/O-free like the rest of the engine, and it never reads the clock —
 * `asOf` arrives from the caller (ADR-0002).
 */

/**
 * The thresholds, in one place, each with the reason it has that value.
 *
 * **Why they are not configurable.** A threshold that can be changed without
 * having to argue for it stops being a decision and becomes a preference. These
 * are provisional and say so; they get tuned against real data, in a commit
 * somebody signs, not in a settings page.
 *
 * `health.test.ts` asserts these values explicitly, so changing one fails a test
 * that names it. That is deliberate: the test is not there to check arithmetic,
 * it is there to make sure nobody moves a threshold quietly.
 */
export const HEALTH_THRESHOLDS = {
  /**
   * Below this much of the sprint elapsed, progress is not judged at all.
   *
   * Being at 8% on the first morning means nothing, and calling it critical
   * would teach the team to ignore the light — which costs more than showing
   * nothing.
   */
  minimumElapsedFraction: 0.2,

  /**
   * Progress achieved against progress expected, as a ratio.
   *
   * At the halfway point roughly half the committed work should be done, so the
   * expectation is the elapsed fraction itself. 0.7 means "a third behind
   * where the calendar is", which is normal turbulence rather than a problem;
   * 0.4 means the sprint is unlikely to land, which is worth saying while
   * something can still be dropped.
   */
  progressWatch: 0.7,
  progressCritical: 0.4,

  /**
   * Work added after the start, as a share of what was committed.
   *
   * Some churn is healthy — a team that never takes anything on mid-sprint is
   * probably not being asked useful questions. A sixth of the commitment
   * arriving late is the point where the plan stops describing the sprint.
   */
  scopeAddedWatch: 0.15,
  scopeAddedCritical: 0.3,

  /**
   * Review wait now, divided by the same figure over the closed sprints.
   *
   * A ratio and not an absolute duration: teams differ enormously in what a
   * normal review takes, and a fixed number of hours would be either noise for
   * one team or silence for another. What matters is that *this* team's review
   * queue is slower than *this* team's habit.
   */
  reviewWaitWatch: 1.5,
  reviewWaitCritical: 2.5,

  /**
   * Items in a column, divided by the limit the team set for that column.
   *
   * Anything above 1 is already the team breaking its own agreement, so the
   * watch threshold is the limit itself. Double is the point where the limit
   * has plainly stopped being observed at all.
   */
  wipOverLimitWatch: 1,
  wipOverLimitCritical: 2,

  /**
   * Share of the sprint's unfinished items that have been sitting longer than
   * 85% of this project's items ever took to finish.
   *
   * The comparison is against the project's own history, for the same reason as
   * review wait. One straggler is ordinary; a sixth of the sprint aged past the
   * point where work usually completes means the sprint is holding items it is
   * not moving.
   */
  agingShareWatch: 0.15,
  agingShareCritical: 0.35,

  /**
   * Share of the items in progress that nobody holds, and has not for a day.
   *
   * **Ours**, like every threshold here, but with a weaker foundation than the
   * others: the book's list of warning signs is a picture, so there is no
   * number to be faithful to. Only the sign itself is quoted (pag. 59).
   *
   * One unheld item in ten is the sort of thing that happens on a Tuesday; a
   * third of the board held by nobody is the situation the book describes,
   * where the team has stopped knowing who is doing what.
   */
  unownedShareWatch: 0.1,
  unownedShareCritical: 0.34,
} as const;

/** The six things looked at. Named so a finding can be traced to its rule. */
export type HealthSignalId =
  | "progress"
  | "scope-added"
  | "review-wait"
  | "wip-limit"
  | "aging"
  /**
   * S3 della ricostruzione: un elemento in lavorazione che nessuno ha in carico.
   *
   * > «Sometimes, for larger teams, a task gets stuck in *Checked out* because
   * > **nobody remembers who was working on it**» (pag. 59)
   *
   * **È una proprietà dell'elemento, mai della persona** (§8.2). Dice «questo
   * elemento è preso in carico da nessuno», non «questa persona ne ha troppi»:
   * la seconda formulazione sarebbe la metrica di performance individuale che
   * §8.2 vieta, ed è a un passo da questa.
   */
  | "unowned";

/**
 * Where a signal stands.
 *
 * `not-evaluable` is a first-class outcome and never collapses into
 * `respected`. "We cannot tell" and "it is fine" are different statements, and
 * a light that says everything is fine because it could not look is worse than
 * no light.
 */
export type HealthStatus = "respected" | "watch" | "critical" | "not-evaluable";

export type HealthSignal = {
  readonly id: HealthSignalId;
  readonly status: HealthStatus;

  /** The catalogue entry the figure comes from, so a reader can check it. */
  readonly metricId: string;

  /** What was measured. `null` only when the signal could not be evaluated. */
  readonly measured: number | null;

  /**
   * The threshold this outcome is measured against.
   *
   * When breached, the one that was breached; when respected, the nearest one —
   * so a reader can see how much room is left, not only that there is some.
   */
  readonly threshold: number | null;

  /**
   * How far past the threshold the measurement is, in the metric's own unit.
   *
   * Required by the specification, and the reason a verdict is arguable: "oltre
   * il limite" invites a shrug, "oltre il limite di tre elementi" does not.
   */
  readonly distance: number | null;

  /** What is missing. Present exactly when the status is `not-evaluable`. */
  readonly missing: string | null;
};

export type SprintHealth = {
  /**
   * The worst of the findings, never an average.
   *
   * An average would let three calm signals bury one serious one, which is the
   * failure mode of every dashboard that reduces a situation to a single score.
   */
  readonly verdict: HealthStatus;
  readonly signals: readonly HealthSignal[];
  /** How much of the sprint has gone, between 0 and 1. */
  readonly elapsedFraction: number;
};

export type SprintHealthInput = {
  readonly sprint: Sprint;
  /** Every item of the project: the sprint's own are derived from the events. */
  readonly items: readonly WorkItem[];
  readonly transitions: readonly StateTransition[];
  readonly scopeEvents: readonly SprintScopeEvent[];
  /** Sprints already closed, for the comparisons that need a habit. */
  readonly closedSprints: readonly Sprint[];
  /** Board columns, for the limits the team declared. May be empty. */
  readonly columns: readonly BoardColumn[];
  readonly asOf: Date;
};

const RESPECTED = (
  id: HealthSignalId,
  metricId: string,
  measured: number,
  threshold: number,
): HealthSignal => ({
  id,
  status: "respected",
  metricId,
  measured,
  threshold,
  distance: null,
  missing: null,
});

const UNKNOWN = (
  id: HealthSignalId,
  metricId: string,
  missing: string,
): HealthSignal => ({
  id,
  status: "not-evaluable",
  metricId,
  measured: null,
  threshold: null,
  distance: null,
  missing,
});

/**
 * Places a measurement against two thresholds, in the direction that is bad.
 *
 * Written once because getting the direction wrong is the easiest mistake in
 * this file: progress is bad when it is *low*, everything else is bad when it
 * is *high*, and a copy of the comparison per signal is four chances to invert
 * one.
 */
function classify(
  id: HealthSignalId,
  metricId: string,
  measured: number,
  thresholds: { readonly watch: number; readonly critical: number },
  worseWhen: "above" | "below",
): HealthSignal {
  const breaches = (threshold: number): boolean =>
    worseWhen === "above" ? measured > threshold : measured < threshold;

  if (breaches(thresholds.critical)) {
    return {
      id,
      status: "critical",
      metricId,
      measured,
      threshold: thresholds.critical,
      distance: Math.abs(measured - thresholds.critical),
      missing: null,
    };
  }

  if (breaches(thresholds.watch)) {
    return {
      id,
      status: "watch",
      metricId,
      measured,
      threshold: thresholds.watch,
      distance: Math.abs(measured - thresholds.watch),
      missing: null,
    };
  }

  return RESPECTED(id, metricId, measured, thresholds.watch);
}

/** Ranks outcomes so "worst" has a meaning that can be tested. */
const SEVERITY: Readonly<Record<HealthStatus, number>> = {
  "not-evaluable": 0,
  respected: 1,
  watch: 2,
  critical: 3,
};

/**
 * How the sprint is going, or a stated inability to tell.
 *
 * Unavailable — rather than a verdict — when the sprint has not started, has
 * already ended, or has dates that make no sense. A judgement about a sprint
 * that is not running is not a cautious judgement, it is a wrong one.
 */
export function sprintHealth(input: SprintHealthInput): MetricResult<SprintHealth> {
  const { sprint, asOf } = input;

  const span = sprint.endsAt.getTime() - sprint.startsAt.getTime();
  // Dates that make no sense are a defect of the source. Inventing a duration
  // for them would hide it behind a plausible percentage.
  if (span <= 0) return unavailable("no-qualifying-data", 0);

  if (asOf.getTime() < sprint.startsAt.getTime()) return unavailable("no-data", 0);
  if (asOf.getTime() > sprint.endsAt.getTime()) return unavailable("no-qualifying-data", 0);

  // Exactly 1 on the last day, never more: a sprint ending today is 100% gone,
  // and 103% is not a thing a reader should ever be shown.
  const elapsedFraction = Math.min(1, (asOf.getTime() - sprint.startsAt.getTime()) / span);

  const members = membershipAt(input.scopeEvents, sprint, asOf);
  const byItem = groupByWorkItem(input.transitions);
  const sprintItems = input.items.filter((item) => members.has(item.id));

  const signals: readonly HealthSignal[] = [
    progressSignal(input, sprintItems, byItem, elapsedFraction),
    scopeAddedSignal(input),
    reviewWaitSignal(input, sprintItems, byItem),
    wipLimitSignal(input, byItem),
    agingSignal(input, sprintItems, byItem),
    unownedSignal(input, sprintItems),
  ];

  const evaluated = signals.filter((signal) => signal.status !== "not-evaluable");

  /*
   * Nessun segnale valutabile significa «non lo so», mai «sereno».
   *
   * È il caso di uno sprint appena aperto e senza dati, ed è esattamente dove
   * un semaforo verde farebbe il danno maggiore: affermerebbe che va tutto
   * bene proprio dove non si è potuto guardare.
   */
  if (evaluated.length === 0) {
    return available(
      { verdict: "not-evaluable", signals, elapsedFraction },
      signals.length,
    );
  }

  const verdict = evaluated.reduce<HealthStatus>(
    (worst, signal) => (SEVERITY[signal.status] > SEVERITY[worst] ? signal.status : worst),
    "respected",
  );

  return available({ verdict, signals, elapsedFraction }, evaluated.length);
}

/**
 * Work finished against work the calendar says should be finished.
 *
 * Measured on estimates when the team estimates, and on item counts when it
 * does not — saying which, because "half the points" and "half the items" are
 * different claims and a reader who assumes the wrong one misjudges the sprint.
 */
function progressSignal(
  input: SprintHealthInput,
  sprintItems: readonly WorkItem[],
  byItem: ReadonlyMap<WorkItemId, readonly StateTransition[]>,
  elapsedFraction: number,
): HealthSignal {
  const id = "progress";
  const metricId = "velocity";

  if (elapsedFraction < HEALTH_THRESHOLDS.minimumElapsedFraction) {
    return UNKNOWN(
      id,
      metricId,
      "lo sprint è appena cominciato: sotto un quinto del tempo trascorso l'avanzamento non dice nulla",
    );
  }

  if (sprintItems.length === 0) {
    return UNKNOWN(id, metricId, "lo sprint non contiene alcun elemento");
  }

  const done = sprintItems.filter(
    (item) => stateAt(byItem.get(item.id) ?? [], input.asOf) === "done",
  );

  const committed = totalEstimates(sprintItems);
  const finished = done.length > 0 ? totalEstimates(done) : null;

  if (committed.mixed) {
    // Punti e ore non si sommano, e una percentuale ricavata da una somma
    // impossibile sarebbe una cifra inventata con l'aria di essere misurata.
    return UNKNOWN(
      id,
      metricId,
      "gli elementi sono stimati in unità diverse, che non si sommano fra loro",
    );
  }

  const total = committed.points ?? committed.hours;

  const completedShare =
    total === null || total === 0
      ? // Nessuna stima, o tutte a zero: si misura sui conteggi, e la pagina lo
        // dichiara invece di lasciar credere che siano punti.
        done.length / sprintItems.length
      : ((finished?.points ?? finished?.hours) ?? 0) / total;

  // Il paragone è con il tempo trascorso: a metà sprint ci si aspetta metà del
  // lavoro. Il rapporto rende confrontabili sprint di lunghezza diversa.
  const ratio = completedShare / elapsedFraction;

  return classify(
    id,
    metricId,
    ratio,
    {
      watch: HEALTH_THRESHOLDS.progressWatch,
      critical: HEALTH_THRESHOLDS.progressCritical,
    },
    "below",
  );
}

/** Work that arrived after the plan was made, against the plan's size. */
function scopeAddedSignal(input: SprintHealthInput): HealthSignal {
  const id = "scope-added";
  const metricId = "scope-change";

  const forSprint = input.scopeEvents.filter(
    (event) => event.sprintId === input.sprint.id,
  );

  if (forSprint.length === 0) {
    return UNKNOWN(id, metricId, "dello sprint non risulta alcuna variazione di perimetro");
  }

  const committed = membershipAt(input.scopeEvents, input.sprint, input.sprint.startsAt);

  if (committed.size === 0) {
    // Tutto è arrivato dopo l'inizio: non c'è un impegno iniziale rispetto a
    // cui misurare una variazione, e dividere per zero produrrebbe un infinito
    // travestito da allarme.
    return UNKNOWN(
      id,
      metricId,
      "all'inizio lo sprint non conteneva nulla: manca il termine di paragone",
    );
  }

  const added = forSprint.filter(
    (event) =>
      event.kind === "added" &&
      event.occurredAt.getTime() > input.sprint.startsAt.getTime() &&
      event.occurredAt.getTime() <= input.asOf.getTime(),
  ).length;

  return classify(
    id,
    metricId,
    added / committed.size,
    {
      watch: HEALTH_THRESHOLDS.scopeAddedWatch,
      critical: HEALTH_THRESHOLDS.scopeAddedCritical,
    },
    "above",
  );
}

/**
 * This sprint's review queue against the same team's closed sprints.
 *
 * **A known imbalance, declared rather than hidden** (open question Q6 in the
 * specification). The two figures are not measured the same way: in closed
 * sprints almost every wait has *ended*, while in the running one many are
 * still open and are measured up to now. An open wait grows by the hour; a
 * finished one does not, so the ratio leans high even when nothing has changed.
 *
 * It is left this way on purpose. Correcting it means choosing between two
 * different definitions — comparing only completed waits, which discards
 * exactly the stuck items the signal exists to find, or truncating the history
 * to an equivalent window — and that is a decision to make against real data
 * rather than by guessing now.
 */
function reviewWaitSignal(
  input: SprintHealthInput,
  sprintItems: readonly WorkItem[],
  byItem: ReadonlyMap<WorkItemId, readonly StateTransition[]>,
): HealthSignal {
  const id = "review-wait";
  const metricId = "review-wait";

  if (input.closedSprints.length < 2) {
    // Uno sprint solo è un caso, non un'abitudine: senza un termine di
    // paragone «più lento del solito» non ha un solito.
    return UNKNOWN(
      id,
      metricId,
      "servono almeno due sprint conclusi per sapere quanto dura di solito una revisione",
    );
  }

  const waitsOf = (items: readonly WorkItem[]): number[] =>
    items
      .map((item) => reviewWaitTime(byItem.get(item.id) ?? [], input.asOf))
      .filter((result) => result.available)
      .map((result) => (result.available ? result.value : 0));

  const current = median(waitsOf(sprintItems));

  const closedIds = new Set(input.closedSprints.map((sprint) => sprint.id));
  const baseline = median(
    waitsOf(input.items.filter((item) => item.sprintId !== null && closedIds.has(item.sprintId))),
  );

  if (!current.available) {
    return UNKNOWN(id, metricId, "nessun elemento di questo sprint è passato da una revisione");
  }

  if (!baseline.available || baseline.value === 0) {
    return UNKNOWN(id, metricId, "gli sprint conclusi non offrono un'attesa in revisione con cui confrontarsi");
  }

  return classify(
    id,
    metricId,
    current.value / baseline.value,
    {
      watch: HEALTH_THRESHOLDS.reviewWaitWatch,
      critical: HEALTH_THRESHOLDS.reviewWaitCritical,
    },
    "above",
  );
}

/**
 * The fullest column against the limit the team set for it.
 *
 * The tightest breach wins when several columns declare a limit: a board is as
 * blocked as its worst column, and averaging them would let a healthy column
 * cover a jammed one.
 */
function wipLimitSignal(
  input: SprintHealthInput,
  byItem: ReadonlyMap<WorkItemId, readonly StateTransition[]>,
): HealthSignal {
  const id = "wip-limit";
  const metricId = "work-in-progress";

  const limits = new Map<WorkItemState, number>();
  for (const column of input.columns) {
    if (column.wipLimit === null) continue;

    const existing = limits.get(column.state);
    // Il più stretto: è la promessa più forte che la squadra ha fatto su quello
    // stato, e ammorbidirla sarebbe una scelta presa al posto suo.
    limits.set(
      column.state,
      existing === undefined ? column.wipLimit : Math.min(existing, column.wipLimit),
    );
  }

  if (limits.size === 0) {
    return UNKNOWN(
      id,
      metricId,
      "nessuna colonna dichiara un limite di lavoro in corso: senza quel dato non si inventa una soglia",
    );
  }

  const counts = new Map<WorkItemState, number>();
  for (const [itemId, history] of byItem) {
    void itemId;
    const state = stateAt(history, input.asOf);
    if (state === null) continue;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  let worst: HealthSignal | null = null;

  for (const [state, limit] of limits) {
    const signal = classify(
      id,
      metricId,
      (counts.get(state) ?? 0) / limit,
      {
        watch: HEALTH_THRESHOLDS.wipOverLimitWatch,
        critical: HEALTH_THRESHOLDS.wipOverLimitCritical,
      },
      "above",
    );

    if (!worst || SEVERITY[signal.status] > SEVERITY[worst.status]) worst = signal;
  }

  return worst ?? UNKNOWN(id, metricId, "nessun limite applicabile");
}

/** Unfinished items sitting longer than this project's work usually takes. */
function agingSignal(
  input: SprintHealthInput,
  sprintItems: readonly WorkItem[],
  byItem: ReadonlyMap<WorkItemId, readonly StateTransition[]>,
): HealthSignal {
  const id = "aging";
  const metricId = "aging";

  const cycleTimes = input.items
    .map((item) => cycleTime(byItem.get(item.id) ?? []))
    .filter((result) => result.available)
    .map((result) => (result.available ? result.value : 0));

  const reference = percentile(cycleTimes, 85);

  if (!reference.available) {
    return UNKNOWN(
      id,
      metricId,
      "il progetto non ha ancora concluso abbastanza elementi da sapere quanto ci mette di solito",
    );
  }

  const open = sprintItems.filter((item) => {
    const state = stateAt(byItem.get(item.id) ?? [], input.asOf);
    return state !== null && state !== "done" && state !== "cancelled";
  });

  if (open.length === 0) {
    return UNKNOWN(id, metricId, "lo sprint non ha elementi aperti da cui misurare un'attesa");
  }

  const stale = open.filter((item) => {
    const history = byItem.get(item.id) ?? [];
    const started = history.find((transition) => transition.toState === "in_progress");
    if (!started) return false;

    return input.asOf.getTime() - started.occurredAt.getTime() > reference.value;
  });

  return classify(
    id,
    metricId,
    stale.length / open.length,
    {
      watch: HEALTH_THRESHOLDS.agingShareWatch,
      critical: HEALTH_THRESHOLDS.agingShareCritical,
    },
    "above",
  );
}

/**
 * Items in progress that nobody holds — the one warning sign the book states.
 *
 * The calculation lives in `unownedWorkInProgress`; here it is only turned
 * into a verdict. Its `no-qualifying-data` becomes `not-evaluable` with the
 * reason spelled out, because "this project does not record who holds an item"
 * and "every item is held" are different situations and one of them is not
 * good news.
 */
function unownedSignal(
  input: SprintHealthInput,
  sprintItems: readonly WorkItem[],
): HealthSignal {
  const id = "unowned";
  const metricId = "unowned-work";

  const result = unownedWorkInProgress({
    items: sprintItems,
    transitions: input.transitions,
    asOf: input.asOf,
    stuckAfterMs: DEFAULT_UNOWNED_STUCK_AFTER_MS,
  });

  if (!result.available) {
    return UNKNOWN(
      id,
      metricId,
      result.reason === "no-data"
        ? "nessuna storia di stati: non si sa quali elementi siano in lavorazione"
        : "lo sprint non ha lavoro in corso, oppure il progetto non registra chi prende in carico gli elementi",
    );
  }

  return classify(
    id,
    metricId,
    result.value.share,
    {
      watch: HEALTH_THRESHOLDS.unownedShareWatch,
      critical: HEALTH_THRESHOLDS.unownedShareCritical,
    },
    "above",
  );
}
