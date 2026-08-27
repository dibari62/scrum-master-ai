import { randomUUID } from "node:crypto";

import {
  boardColumnSchema,
  boardSchema,
  commentSchema,
  estimateChangeSchema,
  impedimentSchema,
  personSchema,
  pullRequestSchema,
  sprintSchema,
  sprintScopeEventSchema,
  sprintStatisticsSchema,
  improvementActionSchema,
  retrospectiveNoteSchema,
  retrospectiveSchema,
  stateTransitionSchema,
  workItemSchema,
  type Board,
  type BoardColumn,
  type Comment,
  type EstimateChange,
  type Impediment,
  type ImprovementAction,
  type OrganizationId,
  type Person,
  type ProjectId,
  type PullRequest,
  type Retrospective,
  type RetrospectiveNote,
  type Sprint,
  type SprintScopeEvent,
  type SprintStatistics,
  type StateTransition,
  type WorkItem,
  type WorkItemKind,
  type WorkItemState,
} from "@/domain";

import type { CanonicalBatch } from "../contract";

import { addDays, addWorkingHours, atHour, nextWorkingDay } from "./calendar";
import { createRandom, type Random } from "./random";
import {
  BACKLOG_ITEMS,
  BOARD_COLUMNS,
  firstSprintStart,
  ITEM_TITLES,
  SPRINT_LENGTH_DAYS,
  SPRINT_PLANS,
  TEAM,
  WORKING_DAYS_PER_SPRINT,
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
  /**
   * The instant the data set is read at.
   *
   * Required, and never defaulted to `new Date()`. A generator that consults
   * the clock produces a different data set on every run, which is untestable;
   * receiving the instant is the same discipline the metrics engine follows
   * (ADR-0002), applied to the thing that writes the data instead of the thing
   * that reads it.
   *
   * Everything is placed backwards from here, so the last sprint is always in
   * flight — and nothing is dated after it.
   */
  readonly asOf: Date;
  /** Same seed and same instant, same data set, on any machine. */
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
  readonly estimateChanges: readonly EstimateChange[];
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

  const firstStart = firstSprintStart(options.asOf);

  const stamps = (at: Date): Timestamps => ({ createdAt: at, updatedAt: at });

  const people = TEAM.map((member, index) =>
    personSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `person-${index + 1}`,
      displayName: member.name,
      email: `${member.mailbox}@example.invalid`,
      ...stamps(firstStart),
    }),
  ) satisfies Person[];

  const board: Board = boardSchema.parse({
    id: randomUUID(),
    ...scope,
    ...SOURCE,
    sourceId: "board-1",
    name: "Checkout",
    ...stamps(firstStart),
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
      ...stamps(firstStart),
    }),
  ) satisfies BoardColumn[];

  const sprints: Sprint[] = [];

  /**
   * The forecast the fictional Scrum Master wrote down at each sprint's start.
   *
   * Authored by the scenario, never derived: a forecast is a statement made at
   * a moment, and computing one now would re-decide it with data the plan never
   * had. See `src/domain/sprint-statistics.ts`.
   */
  const statistics: SprintStatistics[] = [];

  /**
   * Le retrospettive, le loro note e i miglioramenti decisi.
   *
   * Come le previsioni: scritte dallo scenario, non dedotte. Sono ciò che le
   * persone hanno detto, e nessun calcolo può ricostruirlo dai numeri.
   */
  const retrospectives: Retrospective[] = [];
  const retrospectiveNotes: RetrospectiveNote[] = [];
  const improvementActions: ImprovementAction[] = [];

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
    const startsAt = addDays(firstStart, index * SPRINT_LENGTH_DAYS);
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

    statistics.push(
      sprintStatisticsSchema.parse({
        id: randomUUID(),
        ...scope,
        sprintId: sprint.id,
        // Registrata all'inizio, come impone la checklist del capitolo 16.
        recordedAt: startsAt,
        forecastPoints: plan.forecastPoints,
        /*
         * «Meteo di ieri» anche per il primo sprint, che uno storico non ce
         * l'ha.
         *
         * È una semplificazione dichiarata: il metodo giusto lì sarebbe il
         * ripiego al 70%, che però richiede una capacità dichiarata, e le
         * disponibilità non sono ancora nel modello. Meglio un metodo
         * riconoscibile e uniforme che un secondo dato inventato per
         * sostenerne uno.
         */
        method: "yesterdays-weather",
        focusFactor: null,
        teamSize: people.length,
        workingDays: WORKING_DAYS_PER_SPRINT,
        ...stamps(startsAt),
      }),
    );

    /*
     * La retrospettiva si tiene alla fine dello sprint, non all'inizio.
     *
     * Sull'ultimo sprint — ancora aperto — non se ne tiene affatto: una
     * retrospettiva su uno sprint in corso guarderebbe indietro a qualcosa che
     * non è ancora successo. È il taglio giusto, e rende visibile a schermo
     * anche il caso «sprint senza retrospettiva», che su dati reali è comune.
     */
    if (sprint.completedAt !== null) {
      const heldAt = atHour(endsAt, 16);

      const retrospective = retrospectiveSchema.parse({
        id: randomUUID(),
        ...scope,
        sprintId: sprint.id,
        heldAt,
        participantCount: people.length,
        ...stamps(heldAt),
      });
      retrospectives.push(retrospective);

      const columns = [
        ["good", plan.retrospective.good],
        ["could-have-done-better", plan.retrospective.couldHaveDoneBetter],
        ["improvement", plan.retrospective.improvements.map((entry) => entry.title)],
      ] as const;

      for (const [column, texts] of columns) {
        for (const text of texts) {
          retrospectiveNotes.push(
            retrospectiveNoteSchema.parse({
              id: randomUUID(),
              ...scope,
              retrospectiveId: retrospective.id,
              column,
              text,
              ...stamps(heldAt),
            }),
          );
        }
      }

      for (const entry of plan.retrospective.improvements) {
        improvementActions.push(
          improvementActionSchema.parse({
            id: randomUUID(),
            ...scope,
            retrospectiveId: retrospective.id,
            title: entry.title,
            detail: null,
            votes: entry.votes,
            status: entry.status,
            resolvedAt:
              entry.resolvedAfterDays === null
                ? null
                : addDays(heldAt, entry.resolvedAfterDays),
            ...stamps(heldAt),
          }),
        );
      }
    }

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

  /*
   * Il backlog di prodotto: ciò che non è ancora entrato in uno sprint.
   *
   * Prima non esisteva. Ogni elemento generato apparteneva a uno sprint, il che
   * rendeva la definizione del glossario — «insieme **ordinato** di work item
   * non ancora in uno sprint» — vera come intenzione e falsa come fatto.
   *
   * **Nasce presto, non tardi.** Il primo tentativo lo datava dopo l'ultimo
   * sprint, con l'idea che fosse «ciò che resta da fare»; la troncatura lo ha
   * cancellato per intero, perché era datato nel futuro rispetto all'istante di
   * lettura. Aveva ragione lei: un backlog è fatto di cose **scritte a suo
   * tempo e non ancora prese in carico**, non di cose che accadranno. Gli
   * elementi partono qualche giorno dopo l'inizio del progetto e si distanziano
   * di due giorni l'uno dall'altro, restando comodamente prima di `asOf`.
   */
  const backlog = buildProductBacklog({
    scope,
    createdAt: addDays(firstStart, 3),
  });

  return truncateAt(
    {
      people,
      boards: [board],
      boardColumns,
      sprints,
      workItems: [...generated.map((entry) => entry.item), ...backlog.items],
      transitions: [...generated.flatMap((entry) => entry.transitions), ...backlog.transitions],
      estimateChanges: [
        ...generated.flatMap((entry) => entry.estimateChanges),
        ...backlog.estimateChanges,
      ],
      scopeEvents: generated.flatMap((entry) => entry.scopeEvents),
      sprintStatistics: statistics,
      retrospectives,
      retrospectiveNotes,
      improvementActions,
      comments: generated.flatMap((entry) => entry.comments),
      impediments: generated
        .map((entry) => entry.impediment)
        .filter((value): value is Impediment => value !== null),
      pullRequests: generated
        .map((entry) => entry.pullRequest)
        .filter((value): value is PullRequest => value !== null),
    },
    options.asOf,
  );
}

/**
 * The product backlog: what has not entered a sprint yet, in the order the
 * fictional Product Owner put it.
 *
 * Each item carries the two things the book asks for and nothing more: a
 * position (never a score — the author retracts the `Importance` column) and,
 * for the groomed head of the list only, a "how to demo".
 *
 * It still emits **one transition and one estimate change** per item, because
 * the conformance suite requires that every reported state derives from a
 * history. A backlog item's history is short, not absent: it was created, and
 * it was sized.
 */
function buildProductBacklog(input: {
  readonly scope: Scoped;
  readonly createdAt: Date;
}): {
  readonly items: readonly WorkItem[];
  readonly transitions: readonly StateTransition[];
  readonly estimateChanges: readonly EstimateChange[];
} {
  const items: WorkItem[] = [];
  const transitions: StateTransition[] = [];
  const estimateChanges: EstimateChange[] = [];

  for (const [position, entry] of BACKLOG_ITEMS.entries()) {
    const itemId = randomUUID();
    const sourceId = `item-backlog-${position + 1}`;

    /*
     * Due giorni di distanza fra un elemento e il successivo.
     *
     * Serve a rendere l'ordinamento **osservabile**: se tutti nascessero nello
     * stesso istante, un test che ordina per data non distinguerebbe un
     * comparatore corretto da uno che restituisce sempre zero. Due giorni per
     * dodici elementi coprono meno di un mese, quindi l'ultimo resta prima
     * dell'istante di lettura anche sullo scenario più corto.
     */
    const createdAt = addDays(input.createdAt, position * 2);

    const estimate = { value: entry.points, unit: "points" as const };

    items.push(
      workItemSchema.parse({
        id: itemId,
        ...input.scope,
        ...SOURCE,
        sourceId,
        kind: entry.kind,
        title: entry.title,
        // La colonna «Notes» del backlog del libro: chiarimenti e rimandi, non
        // un secondo «come si dimostra».
        description: entry.notes,
        state: "todo",
        estimate,
        backlogOrder: position,
        howToDemo: entry.howToDemo,
        // Non è in nessuno sprint: è esattamente ciò che lo rende backlog.
        sprintId: null,
        assigneeId: null,
        sourceCreatedAt: createdAt,
        parentId: null,
        createdAt,
        updatedAt: createdAt,
      }),
    );

    transitions.push(
      stateTransitionSchema.parse({
        id: randomUUID(),
        ...input.scope,
        ...SOURCE,
        sourceId: `transition-${sourceId}-1`,
        workItemId: itemId,
        fromState: null,
        toState: "todo",
        occurredAt: createdAt,
        actorId: null,
        createdAt,
        updatedAt: createdAt,
      }),
    );

    estimateChanges.push(
      estimateChangeSchema.parse({
        id: randomUUID(),
        ...input.scope,
        ...SOURCE,
        sourceId: `estimate-${sourceId}-1`,
        workItemId: itemId,
        fromEstimate: null,
        toEstimate: estimate,
        occurredAt: createdAt,
        actorId: null,
        createdAt,
        updatedAt: createdAt,
      }),
    );
  }

  return { items, transitions, estimateChanges };
}

/**
 * Removes everything that has not happened yet.
 * **Why this exists at all.** The scenario is written as four whole sprints, but
 * the last one is deliberately still running, so its story runs past the instant
 * the data is read at. Left alone, the data set would contain transitions dated
 * *tomorrow*: items already finished in a future that has not occurred.
 *
 * That would be a worse defect than the one it replaced, precisely because it is
 * invisible. Every individual figure would stay plausible — a velocity, a cycle
 * time, a burndown — and only someone who thought to compare a timestamp against
 * today's date would notice the data set was describing things that had not
 * happened.
 *
 * So the cut is a declared final pass rather than a condition threaded through
 * the generator. Threading it would mean getting it right in a dozen places and
 * remembering it in the thirteenth; here it is one function with one rule, and
 * `seed.test.ts` walks every record and every date field to prove the rule holds
 * — a check that keeps working when a field is added, which is when this kind of
 * rule actually breaks.
 *
 * A work item's `state` is recomputed rather than kept: `state` is a summary of
 * the history, and truncating the history without it would leave an item marked
 * "concluso" whose completion has been removed.
 */
function truncateAt(batch: CanonicalBatch, asOf: Date): CanonicalBatch {
  const cutoff = asOf.getTime();
  const notAfter = (instant: Date): boolean => instant.getTime() <= cutoff;

  /*
   * Un elemento creato dopo l'istante non esiste ancora.
   *
   * Riguarda il lavoro aggiunto a metà dell'ultimo sprint, che nel racconto
   * entra in un giorno che potrebbe non essere ancora arrivato. Sparisce con
   * tutto ciò che lo riguarda: tenerne le transizioni lascerebbe una storia
   * che parla di un elemento inesistente.
   */
  const workItems = batch.workItems.filter((item) => notAfter(item.sourceCreatedAt));
  const live = new Set(workItems.map((item) => item.id));

  const transitions = batch.transitions.filter(
    (transition) => live.has(transition.workItemId) && notAfter(transition.occurredAt),
  );

  /** The last state each surviving item reached, by the time of the cut. */
  const stateAtCutoff = new Map<string, { state: WorkItemState; at: Date }>();
  for (const transition of transitions) {
    const previous = stateAtCutoff.get(transition.workItemId);
    if (!previous || transition.occurredAt.getTime() >= previous.at.getTime()) {
      stateAtCutoff.set(transition.workItemId, {
        state: transition.toState,
        at: transition.occurredAt,
      });
    }
  }

  /** The retrospectives that had already been held by the cut. */
  const liveRetrospectives = batch.retrospectives.filter((entry) =>
    notAfter(entry.heldAt),
  );
  const liveRetrospectiveIds = new Set(liveRetrospectives.map((entry) => entry.id));

  return {
    people: batch.people,
    boards: batch.boards,
    boardColumns: batch.boardColumns,
    sprints: batch.sprints,
    workItems: workItems.map((item) => {
      const reached = stateAtCutoff.get(item.id);

      return workItemSchema.parse({
        ...item,
        state: reached?.state ?? "todo",
        updatedAt: reached?.at ?? item.sourceCreatedAt,
      });
    }),

    transitions,

    /*
     * Anche le stime si tagliano all'istante di lettura.
     *
     * Una ri-stima datata domani è lo stesso difetto delle transizioni future,
     * e più insidiosa: non sposta uno stato, sposta un *numero*, quindi la
     * dashboard resterebbe interamente plausibile mentre riporta una velocity
     * che nessuno poteva conoscere.
     */
    estimateChanges: batch.estimateChanges.filter(
      (change) => live.has(change.workItemId) && notAfter(change.occurredAt),
    ),

    scopeEvents: batch.scopeEvents.filter(
      (event) => live.has(event.workItemId) && notAfter(event.occurredAt),
    ),

    /*
     * Anche le previsioni si tagliano.
     *
     * Una previsione datata domani sarebbe una previsione che nessuno poteva
     * ancora aver scritto — e a differenza di una transizione futura non
     * salterebbe all'occhio, perché una previsione parla comunque del futuro.
     */
    sprintStatistics: batch.sprintStatistics.filter((entry) =>
      notAfter(entry.recordedAt),
    ),

    /*
     * E le retrospettive.
     *
     * Una retrospettiva datata domani sarebbe una riunione che non si è ancora
     * tenuta, con dentro le opinioni di chi non l'ha ancora espressa. Le note e
     * i miglioramenti seguono la loro retrospettiva: senza il filtro
     * resterebbero orfani, che è peggio che assenti.
     */
    retrospectives: liveRetrospectives,

    retrospectiveNotes: batch.retrospectiveNotes.filter((note) =>
      liveRetrospectiveIds.has(note.retrospectiveId),
    ),

    improvementActions: batch.improvementActions
      .filter((action) => liveRetrospectiveIds.has(action.retrospectiveId))
      .map((action) =>
        // Deciso prima, chiuso dopo: all'istante del taglio è ancora aperto.
        // Lo stesso trattamento che riceve un impedimento risolto oltre il
        // taglio, e per la stessa ragione.
        action.resolvedAt !== null && !notAfter(action.resolvedAt)
          ? improvementActionSchema.parse({ ...action, resolvedAt: null, status: "open" })
          : action,
      ),

    comments: batch.comments.filter(
      (comment) => live.has(comment.workItemId) && notAfter(comment.postedAt),
    ),

    impediments: batch.impediments
      .filter(
        (impediment) =>
          notAfter(impediment.raisedAt) &&
          (impediment.workItemId === null || live.has(impediment.workItemId)),
      )
      .map((impediment) =>
        // Sollevato prima, risolto dopo: al momento del taglio è ancora aperto,
        // ed è la sola lettura onesta di quel record.
        impediment.resolvedAt !== null && !notAfter(impediment.resolvedAt)
          ? impedimentSchema.parse({ ...impediment, resolvedAt: null })
          : impediment,
      ),

    pullRequests: batch.pullRequests
      .filter(
        (request) =>
          notAfter(request.openedAt) &&
          // Una pull request può non citare alcun elemento: in quel caso non
          // c'è nulla di cui essere orfana, e sopravvive al taglio.
          (request.workItemId === null || live.has(request.workItemId)),
      )
      .map((request) =>
        pullRequestSchema.parse({
          ...request,
          firstReviewAt:
            request.firstReviewAt !== null && !notAfter(request.firstReviewAt)
              ? null
              : request.firstReviewAt,
          mergedAt:
            request.mergedAt !== null && !notAfter(request.mergedAt)
              ? null
              : request.mergedAt,
        }),
      ),
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
  let reEstimatedRemaining = plan.reEstimatedItems;

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

    /*
     * Ri-stimato a sprint iniziato.
     *
     * Riservato agli elementi **pianificati**: per uno entrato a metà sprint la
     * stima d'ingresso è già quella corretta, e ri-stimarlo subito dopo non
     * proverebbe nulla. Su un elemento presente dall'inizio, invece, la stima
     * iniziale e quella finale differiscono davvero — che è la sola situazione
     * in cui la regola del libro produce un numero diverso dall'ingenuo.
     */
    const reEstimated = !addedMidSprint && reEstimatedRemaining > 0 && random.chance(0.5);
    if (reEstimated) reEstimatedRemaining -= 1;

    /*
     * Quante delle aggiunte in corsa sono dichiarate interruzioni.
     *
     * Non tutte, di proposito. Il piano di sprint dice quante lo sono, e le
     * restanti restano `null` — «la fonte non lo dice» — perché è così che si
     * presenta un progetto vero: una parte delle interruzioni non viene
     * registrata da nessuno.
     *
     * Un dato di prova in cui ogni evento è classificato mostrerebbe la
     * funzione al lavoro in una condizione che su dati veri non si verifica
     * quasi mai, e nasconderebbe proprio il caso che il portale deve saper
     * dichiarare.
     */
    const unplanned = addedMidSprint && position - plan.plannedItems < plan.unplannedItems;

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
      unplanned,
      blocked,
      reopened,
      finishes,
      reEstimated,
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

  /**
   * Whether this mid-sprint arrival was an interruption rather than a
   * deliberate extension of the plan.
   *
   * Only meaningful together with `addedMidSprint`: what was there at the start
   * is the commitment, not a change to it.
   */
  readonly unplanned: boolean;
  readonly blocked: boolean;
  readonly reopened: boolean;
  readonly finishes: boolean;
  readonly reEstimated: boolean;
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

  const initialEstimate =
    kind === "spike" ? null : { value: random.pick([1, 2, 3, 5, 8]), unit: "points" as const };

  /*
   * Ri-stima solo se c'era una stima da correggere.
   *
   * Uno spike non è stimato per definizione — è un'indagine, e stimarla
   * significherebbe sapere già la risposta. Ri-stimare da «nessuna stima» a un
   * numero non è una correzione ma una prima stima, e mescolare i due casi
   * renderebbe il dato di prova ambiguo proprio nel punto che deve chiarire.
   */
  const finalEstimate =
    input.reEstimated && initialEstimate
      ? { value: initialEstimate.value * plan.reEstimateFactor, unit: "points" as const }
      : initialEstimate;

  const item = workItemSchema.parse({
    id: itemId,
    ...scope,
    ...SOURCE,
    sourceId: `item-${sourceSuffix}`,
    kind,
    title: input.title,
    description: null,
    state: finalState,
    // Lo stato *corrente*: dopo la ri-stima, cioè il numero più grande. È
    // esattamente ciò che velocity non deve usare.
    estimate: finalEstimate,
    /*
     * Un elemento già in uno sprint non ha una posizione in backlog.
     *
     * `null` non è «ultimo»: è uscito dalla lista da pianificare nel momento in
     * cui è entrato in uno sprint, e dargli una posizione lo rimetterebbe in
     * coda a un piano di rilascio che non deve più contenerlo.
     */
    backlogOrder: null,
    howToDemo: null,
    sprintId: sprint.id,
    assigneeId: assignee.id,
    sourceCreatedAt: createdAt,
    parentId: null,
    createdAt,
    updatedAt: moves[moves.length - 1]?.at ?? createdAt,
  });

  /*
   * La storia delle stime.
   *
   * Il primo evento è la stima alla nascita, e c'è **sempre**: senza, un
   * elemento risulterebbe privo di storia e ogni calcolo ripiegherebbe sulla
   * stima corrente, che è la lettura che stiamo cercando di evitare.
   *
   * Il secondo, quando c'è, cade a sprint iniziato — così velocity lo ignora e
   * il burndown lo mostra. Sono due letture diverse dello stesso fatto, ed è
   * voluto: la velocity misura ciò che era stato promesso, il burndown ciò che
   * la squadra crede oggi di avere davanti.
   */
  const estimateChanges: EstimateChange[] = [
    estimateChangeSchema.parse({
      id: randomUUID(),
      ...scope,
      ...SOURCE,
      sourceId: `estimate-${sourceSuffix}-1`,
      workItemId: itemId,
      fromEstimate: null,
      toEstimate: initialEstimate,
      occurredAt: createdAt,
      actorId: assignee.id,
      createdAt,
      updatedAt: createdAt,
    }),
  ];

  if (finalEstimate !== initialEstimate) {
    const reEstimatedAt = atHour(
      nextWorkingDay(addDays(input.enteredAt, random.int(2, 5))),
      random.int(10, 16),
    );

    estimateChanges.push(
      estimateChangeSchema.parse({
        id: randomUUID(),
        ...scope,
        ...SOURCE,
        sourceId: `estimate-${sourceSuffix}-2`,
        workItemId: itemId,
        fromEstimate: initialEstimate,
        toEstimate: finalEstimate,
        occurredAt: reEstimatedAt,
        actorId: assignee.id,
        createdAt: reEstimatedAt,
        updatedAt: reEstimatedAt,
      }),
    );
  }

  const scopeEvents: SprintScopeEvent[] = [
    sprintScopeEventSchema.parse({
      ...scope,
      ...SOURCE,
      sourceId: `scope-${sourceSuffix}-added`,
      sprintId: sprint.id,
      workItemId: itemId,
      kind: "added",
      /*
       * Solo le aggiunte a sprint iniziato hanno un perché.
       *
       * Ciò che c'era alla partenza è l'impegno, non un cambiamento: dargli un
       * motivo suggerirebbe che qualcuno abbia deciso qualcosa in corsa.
       *
       * Fra le aggiunte in corsa, lo scenario dichiara **interruzione** quelle
       * che il piano di sprint marca come tali e lascia `null` le altre: è
       * così che si presenta un progetto vero, dove una parte delle
       * interruzioni non viene registrata da nessuno. Un dato di prova in cui
       * ogni evento è classificato dimostrerebbe una funzione che su dati veri
       * non si vedrebbe mai lavorare.
       */
      reason: input.addedMidSprint ? (input.unplanned ? "unplanned" : null) : null,
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

  return {
    item,
    transitions,
    estimateChanges,
    scopeEvents,
    comments,
    pullRequest,
    impediment,
  };
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
    // Un'uscita non ha un «perché» in questo senso: la distinzione del libro è
    // fra un piano esteso e un piano interrotto, ed è sulle entrate.
    reason: null,
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
    // Un elemento trascinato entra all'inizio dello sprint: è impegno, non
    // un'aggiunta in corsa.
    reason: null,
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
    // Un elemento trascinato conserva la propria storia delle stime: è lo
    // stesso elemento, non uno nuovo, e ricominciarla cancellerebbe la stima
    // con cui era entrato la prima volta.
    estimateChanges: previous.estimateChanges,
    scopeEvents: [...previous.scopeEvents, removed, added],
    comments: previous.comments,
    pullRequest: previous.pullRequest,
    impediment: previous.impediment,
  };
}

function isDone(entry: GeneratedItem): boolean {
  return entry.item.state === "done";
}
