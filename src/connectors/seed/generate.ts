import { randomUUID } from "node:crypto";

import {
  boardColumnSchema,
  boardSchema,
  commentSchema,
  impedimentSchema,
  personSchema,
  pullRequestSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  workItemSchema,
  type Board,
  type BoardColumn,
  type Comment,
  type Impediment,
  type OrganizationId,
  type Person,
  type ProjectId,
  type PullRequest,
  type Sprint,
  type SprintScopeEvent,
  type StateTransition,
  type WorkItem,
  type WorkItemKind,
  type WorkItemState,
} from "@/domain";

import type { CanonicalBatch } from "../contract";

import { addDays, addWorkingHours, atHour, nextWorkingDay } from "./calendar";
import { createRandom, type Random } from "./random";
import {
  BOARD_COLUMNS,
  FIRST_SPRINT_START,
  ITEM_TITLES,
  SPRINT_LENGTH_DAYS,
  SPRINT_PLANS,
  TEAM,
  type SprintPlan,
} from "./scenario";

/**
 * Renders the scenario into canonical records.
 *
 * The generator has no native format to translate from — it *is* the source —
 * but it produces exactly what a real connector produces, which is the whole
 * point of ADR-0003: metrics and skills can be built against it and will keep
 * working when a real integration replaces it.
 *
 * Identifiers are generated fresh on each call while `sourceId` is derived from
 * position, so two runs reconcile onto the same rows instead of duplicating.
 * That is the idempotence the connector instructions require, demonstrated
 * rather than asserted.
 */

export type GenerateOptions = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  /** Same seed, same data set, on any machine. */
  readonly seed?: number;
};

const SOURCE = { sourceSystem: "seed" } as const;

/** Weighted so the backlog looks like a backlog: mostly stories, some defects. */
const KINDS: readonly WorkItemKind[] = [
  "story",
  "story",
  "story",
  "story",
  "bug",
  "bug",
  "task",
  "spike",
];

type Scoped = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
};

type Timestamps = { readonly createdAt: Date; readonly updatedAt: Date };

/**
 * A work item plus the story of how it moved.
 *
 * Kept together while generating: a transition list separated from its item is
 * the easiest way to produce a history that refers to something that does not
 * exist.
 */
type GeneratedItem = {
  readonly item: WorkItem;
  readonly transitions: readonly StateTransition[];
  readonly scopeEvents: readonly SprintScopeEvent[];
  readonly comments: readonly Comment[];
  readonly pullRequest: PullRequest | null;
  readonly impediment: Impediment | null;
};

export function generateSeedBatch(options: GenerateOptions): CanonicalBatch {
  const random = createRandom(options.seed ?? 20260406);
  const scope: Scoped = {
    organizationId: options.organizationId,
    projectId: options.projectId,
  };

  const stamps = (at: Date): Timestamps => ({ createdAt: at, updatedAt: at });

  const people = TEAM.map((member, index) =>
    personSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `person-${index + 1}`,
      displayName: member.name,
      email: `${member.mailbox}@example.invalid`,
      ...stamps(FIRST_SPRINT_START),
    }),
  ) satisfies Person[];

  const board: Board = boardSchema.parse({
    id: randomUUID(),
    ...scope,
    ...SOURCE,
    sourceId: "board-1",
    name: "Checkout",
    ...stamps(FIRST_SPRINT_START),
  });

  const boardColumns = BOARD_COLUMNS.map((column, index) =>
    boardColumnSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `column-${index + 1}`,
      boardId: board.id,
      name: column.name,
      state: column.state,
      position: index,
      wipLimit: column.wipLimit,
      ...stamps(FIRST_SPRINT_START),
    }),
  ) satisfies BoardColumn[];

  const sprints: Sprint[] = [];

  /**
   * One entry per work item, keyed by identifier.
   *
   * A map rather than a list because an item carried into the next sprint is
   * the *same* item with a longer history — appending it again would emit its
   * transitions twice and produce a history that contradicts itself.
   */
  const itemsById = new Map<string, GeneratedItem>();

  /** Items left unfinished by a sprint, waiting to be pulled into the next. */
  let carriedOver: GeneratedItem[] = [];
  let titleCursor = 0;

  for (const [index, plan] of SPRINT_PLANS.entries()) {
    const startsAt = addDays(FIRST_SPRINT_START, index * SPRINT_LENGTH_DAYS);
    const endsAt = addDays(startsAt, SPRINT_LENGTH_DAYS - 1);

    const sprint = sprintSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `sprint-${index + 1}`,
      name: plan.name,
      goal: plan.goal,
      startsAt,
      endsAt,
      // The last sprint is still running: leaving it open is what makes
      // "current sprint health" a question worth asking.
      completedAt: index === SPRINT_PLANS.length - 1 ? null : atHour(endsAt, 17),
      ...stamps(startsAt),
    });
    sprints.push(sprint);

    const results = generateSprintItems({
      scope,
      sprint,
      plan,
      people,
      random,
      carriedOver,
      titleFrom: titleCursor,
    });

    titleCursor = results.nextTitleCursor;
    // Replaces the carried entries and adds the new ones, so each item is
    // present exactly once with its full history.
    for (const entry of results.items) itemsById.set(entry.item.id, entry);
    carriedOver = [...results.unfinished];
  }

  const generated = [...itemsById.values()];

  return {
    people,
    boards: [board],
    boardColumns,
    sprints,
    workItems: generated.map((entry) => entry.item),
    transitions: generated.flatMap((entry) => entry.transitions),
    scopeEvents: generated.flatMap((entry) => entry.scopeEvents),
    comments: generated.flatMap((entry) => entry.comments),
    impediments: generated
      .map((entry) => entry.impediment)
      .filter((value): value is Impediment => value !== null),
    pullRequests: generated
      .map((entry) => entry.pullRequest)
      .filter((value): value is PullRequest => value !== null),
  };
}

type SprintGenerationInput = {
  readonly scope: Scoped;
  readonly sprint: Sprint;
  readonly plan: SprintPlan;
  readonly people: readonly Person[];
  readonly random: Random;
  readonly carriedOver: readonly GeneratedItem[];
  readonly titleFrom: number;
};

type SprintGenerationResult = {
  readonly items: readonly GeneratedItem[];
  readonly unfinished: readonly GeneratedItem[];
  readonly nextTitleCursor: number;
};

function generateSprintItems(input: SprintGenerationInput): SprintGenerationResult {
  const { scope, sprint, plan, people, random } = input;

  const items: GeneratedItem[] = [];
  const unfinished: GeneratedItem[] = [];
  let titleCursor = input.titleFrom;

  const totalNew = plan.plannedItems + plan.addedMidSprint;
  const incompleteTarget = Math.round(plan.plannedItems * plan.incompleteShare);

  let blockedRemaining = plan.blockedItems;
  let reopenedRemaining = plan.reopenedItems;
  let incompleteRemaining = incompleteTarget;

  for (let position = 0; position < totalNew; position += 1) {
    const addedMidSprint = position >= plan.plannedItems;

    const enteredAt = addedMidSprint
      ? // Strictly after the start, so it counts as a scope change.
        atHour(
          nextWorkingDay(addDays(sprint.startsAt, random.int(3, 8))),
          random.int(9, 16),
        )
      : sprint.startsAt;

    const blocked = blockedRemaining > 0 && random.chance(0.55);
    if (blocked) blockedRemaining -= 1;

    const reopened = !blocked && reopenedRemaining > 0 && random.chance(0.5);
    if (reopened) reopenedRemaining -= 1;

    const finishes = incompleteRemaining <= 0 || random.chance(0.6);
    if (!finishes) incompleteRemaining -= 1;

    const title = ITEM_TITLES[titleCursor % ITEM_TITLES.length] ?? "Attività";
    titleCursor += 1;

    const generatedItem = buildItem({
      scope,
      sprint,
      plan,
      people,
      random,
      title,
      sourceSuffix: `${sprint.sourceId}-${position + 1}`,
      enteredAt,
      addedMidSprint,
      blocked,
      reopened,
      finishes,
    });

    items.push(generatedItem);
    if (!finishes) unfinished.push(generatedItem);
  }

  // Work dragged in from the previous sprint: same item, a fresh scope event,
  // and a history that continues instead of starting over.
  for (const previous of input.carriedOver) {
    const continued = continueCarriedItem({ scope, sprint, plan, random, previous });
    items.push(continued);
    if (!isDone(continued)) unfinished.push(continued);
  }

  return { items, unfinished, nextTitleCursor: titleCursor };
}

type BuildItemInput = {
  readonly scope: Scoped;
  readonly sprint: Sprint;
  readonly plan: SprintPlan;
  readonly people: readonly Person[];
  readonly random: Random;
  readonly title: string;
  readonly sourceSuffix: string;
  readonly enteredAt: Date;
  readonly addedMidSprint: boolean;
  readonly blocked: boolean;
  readonly reopened: boolean;
  readonly finishes: boolean;
};

function buildItem(input: BuildItemInput): GeneratedItem {
  const { scope, sprint, plan, people, random, sourceSuffix } = input;

  const itemId = randomUUID();
  const assignee = random.pick(people);
  const kind = random.pick(KINDS);

  const createdAt = atHour(addDays(input.enteredAt, -random.int(1, 6)), random.int(9, 17));

  const moves = buildHistory({ ...input, createdAt });
  const finalState = moves[moves.length - 1]?.to ?? "todo";

  const transitions = moves.map((move, index) =>
    stateTransitionSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `transition-${sourceSuffix}-${index + 1}`,
      workItemId: itemId,
      fromState: move.from,
      toState: move.to,
      occurredAt: move.at,
      actorId: assignee.id,
      createdAt: move.at,
      updatedAt: move.at,
    }),
  );

  const item = workItemSchema.parse({
    id: itemId,
    ...scope,
    ...SOURCE,
    sourceId: `item-${sourceSuffix}`,
    kind,
    title: input.title,
    description: null,
    state: finalState,
    estimate:
      kind === "spike" ? null : { value: random.pick([1, 2, 3, 5, 8]), unit: "points" },
    sprintId: sprint.id,
    assigneeId: assignee.id,
    sourceCreatedAt: createdAt,
    parentId: null,
    createdAt,
    updatedAt: moves[moves.length - 1]?.at ?? createdAt,
  });

  const scopeEvents: SprintScopeEvent[] = [
    sprintScopeEventSchema.parse({
      ...scope,
      ...SOURCE,
      sourceId: `scope-${sourceSuffix}-added`,
      sprintId: sprint.id,
      workItemId: itemId,
      kind: "added",
      occurredAt: input.enteredAt,
      createdAt: input.enteredAt,
      updatedAt: input.enteredAt,
    }),
  ];

  const reviewMove = moves.find((move) => move.to === "in_review");
  const pullRequest = reviewMove
    ? pullRequestSchema.parse({
        id: randomUUID(),
        ...scope,
        ...SOURCE,
        sourceId: `pr-${sourceSuffix}`,
        title: `${input.title} (modifica)`,
        authorId: assignee.id,
        workItemId: itemId,
        openedAt: reviewMove.at,
        firstReviewAt: addWorkingHours(
          reviewMove.at,
          random.int(plan.reviewWaitHours[0], plan.reviewWaitHours[1]),
        ),
        mergedAt: finalState === "done" ? (moves[moves.length - 1]?.at ?? null) : null,
        closedAt: null,
        createdAt: reviewMove.at,
        updatedAt: reviewMove.at,
      })
    : null;

  const blockedMove = moves.find((move) => move.to === "blocked");
  const unblockIndex = moves.findIndex((move) => move.from === "blocked");
  const impediment = blockedMove
    ? impedimentSchema.parse({
        id: randomUUID(),
        ...scope,
        ...SOURCE,
        sourceId: `impediment-${sourceSuffix}`,
        title: `Attesa esterna su: ${input.title}`,
        description: null,
        workItemId: itemId,
        raisedAt: blockedMove.at,
        resolvedAt: unblockIndex >= 0 ? (moves[unblockIndex]?.at ?? null) : null,
        createdAt: blockedMove.at,
        updatedAt: blockedMove.at,
      })
    : null;

  const comments = reviewMove
    ? [
        commentSchema.parse({
          id: randomUUID(),
          ...scope,
          ...SOURCE,
          sourceId: `comment-${sourceSuffix}-1`,
          workItemId: itemId,
          authorId: random.pick(people).id,
          body: "Ho guardato la modifica: manca un caso di errore, per il resto va bene.",
          postedAt: pullRequest?.firstReviewAt ?? reviewMove.at,
          createdAt: reviewMove.at,
          updatedAt: reviewMove.at,
        }),
      ]
    : [];

  return { item, transitions, scopeEvents, comments, pullRequest, impediment };
}

type Move = { readonly from: WorkItemState | null; readonly to: WorkItemState; readonly at: Date };

type HistoryInput = BuildItemInput & { readonly createdAt: Date };

/**
 * Builds one item's history, move by move.
 *
 * Written as a chain where each step starts from the previous state, so the
 * result cannot contradict itself. `findHistoryDefects` in the domain checks
 * exactly that, and the conformance suite runs it over everything produced
 * here — a connector emitting an incoherent history would produce metrics that
 * are wrong in ways nobody notices, since each individual number still looks
 * plausible.
 */
function buildHistory(input: HistoryInput): readonly Move[] {
  const { plan, random, sprint } = input;

  const moves: Move[] = [{ from: null, to: "todo", at: input.createdAt }];
  let current: WorkItemState = "todo";
  let at = input.enteredAt;

  const move = (to: WorkItemState, hours: number): void => {
    at = addWorkingHours(at, hours);
    moves.push({ from: current, to, at });
    current = to;
  };

  move("in_progress", random.int(2, 30));

  if (input.blocked) {
    move("blocked", random.int(3, 12));
    const days = random.int(plan.blockedDays[0], plan.blockedDays[1]);
    move("in_progress", Math.max(days, 1) * 24);
  }

  move("in_review", random.int(4, 24));

  if (!input.finishes) {
    // Still waiting when the sprint closes: this is what carry-over looks like
    // from the inside.
    return moves;
  }

  move("done", random.int(plan.reviewWaitHours[0], plan.reviewWaitHours[1]));

  if (input.reopened) {
    move("in_progress", random.int(12, 48));
    move("in_review", random.int(4, 16));
    move("done", random.int(plan.reviewWaitHours[0], plan.reviewWaitHours[1]));
  }

  // An item cannot finish after the sprint it belongs to has ended.
  const last = moves[moves.length - 1];
  if (last && last.at.getTime() > sprint.endsAt.getTime()) {
    return moves.slice(0, -1);
  }

  return moves;
}

type ContinueInput = {
  readonly scope: Scoped;
  readonly sprint: Sprint;
  readonly plan: SprintPlan;
  readonly random: Random;
  readonly previous: GeneratedItem;
};

/**
 * Pulls an unfinished item into the next sprint.
 *
 * The item keeps its identity and its history: carry-over is the *same* work
 * appearing again, and generating a fresh item would make the metric measure
 * nothing.
 */
function continueCarriedItem(input: ContinueInput): GeneratedItem {
  const { scope, sprint, plan, random, previous } = input;

  const history = [...previous.transitions];
  const lastTransition = history[history.length - 1];
  const currentState: WorkItemState = lastTransition?.toState ?? "todo";

  const moves: Move[] = [];
  let at = sprint.startsAt;
  let current = currentState;

  const move = (to: WorkItemState, hours: number): void => {
    at = addWorkingHours(at, hours);
    moves.push({ from: current, to, at });
    current = to;
  };

  if (current === "in_review") {
    move("done", random.int(plan.reviewWaitHours[0], plan.reviewWaitHours[1]));
  } else if (current !== "done") {
    move("in_review", random.int(6, 40));
    move("done", random.int(plan.reviewWaitHours[0], plan.reviewWaitHours[1]));
  }

  const extraTransitions = moves.map((entry, index) =>
    stateTransitionSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `transition-${previous.item.sourceId}-carry-${sprint.sourceId}-${index + 1}`,
      workItemId: previous.item.id,
      fromState: entry.from,
      toState: entry.to,
      occurredAt: entry.at,
      actorId: previous.item.assigneeId,
      createdAt: entry.at,
      updatedAt: entry.at,
    }),
  );

  const removed = sprintScopeEventSchema.parse({
    ...scope,
    ...SOURCE,
    sourceId: `scope-${previous.item.sourceId}-removed-${sprint.sourceId}`,
    sprintId: previous.scopeEvents[0]?.sprintId ?? sprint.id,
    workItemId: previous.item.id,
    kind: "removed",
    occurredAt: sprint.startsAt,
    createdAt: sprint.startsAt,
    updatedAt: sprint.startsAt,
  });

  const added = sprintScopeEventSchema.parse({
    ...scope,
    ...SOURCE,
    sourceId: `scope-${previous.item.sourceId}-added-${sprint.sourceId}`,
    sprintId: sprint.id,
    workItemId: previous.item.id,
    kind: "added",
    occurredAt: sprint.startsAt,
    createdAt: sprint.startsAt,
    updatedAt: sprint.startsAt,
  });

  const finalState = moves[moves.length - 1]?.to ?? currentState;

  return {
    item: workItemSchema.parse({
      ...previous.item,
      state: finalState,
      sprintId: sprint.id,
      updatedAt: at,
    }),
    transitions: [...history, ...extraTransitions],
    scopeEvents: [...previous.scopeEvents, removed, added],
    comments: previous.comments,
    pullRequest: previous.pullRequest,
    impediment: previous.impediment,
  };
}

function isDone(entry: GeneratedItem): boolean {
  return entry.item.state === "done";
}
