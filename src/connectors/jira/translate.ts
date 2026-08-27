import {
  boardColumnSchema,
  boardSchema,
  commentSchema,
  estimateChangeSchema,
  personSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  workItemSchema,
  type Estimate,
  type WorkItemState,
} from "@/domain";

import { EMPTY_BATCH, type CanonicalBatch } from "../contract";

import { STATUS_CATEGORY_FALLBACK, type JiraConfig } from "./config";
import { jiraId } from "./ids";
import type { JiraChangelogEntry, JiraIssue, JiraSnapshot, JiraUser } from "./types";

/**
 * From what Jira sends to what the rest of the portal understands.
 *
 * **A pure function, and that is the whole design.** Reading and translating are
 * two jobs, and keeping them apart is what makes this one testable: a recorded
 * snapshot is a file, and a file needs no token, no network and no clock. Every
 * rule below can therefore be checked against a payload somebody actually
 * received, instead of against a mock somebody imagined.
 *
 * ## Reconstructing a history from a snapshot plus a list of changes
 *
 * Jira records **changes**, not states. It will tell you an issue moved from «To
 * Do» to «In Progress» on the 4th, and separately that it is «Done» today, but
 * never what it was on the 7th. Our metrics need exactly that.
 *
 * The reconstruction is the same for all three histories — states, estimates,
 * sprint membership — and it runs *forwards from the beginning*, not backwards
 * from today:
 *
 * 1. the starting value is the `from` of the **first** recorded change;
 * 2. if nothing was ever recorded, the starting value is what it is **now**;
 * 3. one event per recorded change, in order.
 *
 * Step 2 deserves saying out loud: an issue created at 5 points and never
 * re-estimated has an empty changelog, and the honest reading is «it has always
 * been 5», not «we know nothing». The contract says the same thing about sources
 * that expose only a current value.
 *
 * ## Two statuses, one state
 *
 * A project with both «In Review» and «Code Review» mapped to `in_review`
 * produces a changelog entry that changes nothing on our side. Those are dropped
 * rather than recorded: `findHistoryDefects` counts a transition from a state to
 * itself as a defect, and it is right to — a history full of moves that move
 * nothing would inflate every count of «how often does this bounce».
 */

export type TranslateOptions = {
  readonly organizationId: string;
  readonly projectId: string;
  readonly config: JiraConfig;
  readonly snapshot: JiraSnapshot;

  /** When the ingestion is considered to happen. Never read from the clock. */
  readonly asOf: Date;
};

export type TranslationResult = {
  readonly batch: CanonicalBatch;

  /**
   * Jira statuses nobody mapped, with the state they fell back to.
   *
   * Reported rather than thrown: refusing an entire synchronisation because
   * somebody added a column to a board would mean that a routine act of
   * housekeeping switches the portal off. Reported rather than swallowed,
   * because `statusCategory` cannot tell a review queue from active work, and a
   * silent fallback would quietly flatten a flow metric.
   */
  readonly unmappedStatuses: readonly string[];
};

const SYSTEM = "jira" as const;

/** Jira writes `2021-01-28T07:37:40.000+0000`, which `Date` reads correctly. */
function instant(value: string): Date {
  return new Date(value);
}

function audit(at: Date): { readonly createdAt: Date; readonly updatedAt: Date } {
  return { createdAt: at, updatedAt: at };
}

/** Empty strings are how Jira spells «nothing» in a changelog. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parsePoints(value: string | null | undefined): Estimate | null {
  const raw = text(value);
  if (raw === null) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return { value: parsed, unit: "points" };
}

function sameEstimate(a: Estimate | null, b: Estimate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.value === b.value && a.unit === b.unit;
}

/** Sorted oldest first, ties broken by the identifier Jira assigned. */
function orderedChangelog(issue: JiraIssue): readonly JiraChangelogEntry[] {
  return [...issue.changelog].sort((a, b) => {
    const byTime = instant(a.created).getTime() - instant(b.created).getTime();
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** `"12, 13"` → `[12, 13]`. Jira writes sprint membership as a printed list. */
function parseSprintList(value: string | null | undefined): readonly number[] {
  const raw = text(value);
  if (raw === null) return [];

  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id));
}

export function translateSnapshot(options: TranslateOptions): TranslationResult {
  const { config, snapshot, organizationId, projectId, asOf } = options;

  const scope = { organizationId, projectId } as const;
  const source = { sourceSystem: SYSTEM } as const;

  const storyPointsFieldId = findFieldId(snapshot, config.storyPointsFieldNames);
  const howToDemoFieldId =
    config.howToDemoFieldName === null
      ? null
      : findFieldId(snapshot, [config.howToDemoFieldName]);

  const unmapped = new Set<string>();

  /** A Jira status name to one of our six states, saying so when it guesses. */
  const mapState = (
    name: string | null | undefined,
    categoryKey?: string | null,
  ): WorkItemState | null => {
    const key = text(name);
    if (key === null) return null;

    const declared = config.stateMapping[key];
    if (declared) return declared;

    unmapped.add(key);
    return STATUS_CATEGORY_FALLBACK[text(categoryKey) ?? ""] ?? "todo";
  };

  // ── Persone ────────────────────────────────────────────────────────────────
  const users = new Map<string, JiraUser>();
  const remember = (user: JiraUser | null | undefined): string | null => {
    if (!user) return null;
    if (!users.has(user.accountId)) users.set(user.accountId, user);
    return jiraId("person", user.accountId);
  };

  // ── Sprint ─────────────────────────────────────────────────────────────────
  const sprints = snapshot.sprints
    // Uno sprint senza date non è collocabile nel tempo, e ogni metrica di
    // sprint parte da un intervallo. Tenerlo significherebbe inventarne uno.
    .filter((sprint) => text(sprint.startDate) !== null && text(sprint.endDate) !== null)
    .map((sprint) =>
      sprintSchema.parse({
        id: jiraId("sprint", String(sprint.id)),
        ...scope,
        ...source,
        sourceId: String(sprint.id),
        name: sprint.name,
        goal: text(sprint.goal),
        startsAt: instant(sprint.startDate ?? ""),
        endsAt: instant(sprint.endDate ?? ""),
        completedAt: text(sprint.completeDate) ? instant(sprint.completeDate ?? "") : null,
        ...audit(asOf),
      }),
    );

  const knownSprints = new Set(snapshot.sprints.map((sprint) => sprint.id));
  for (const sprint of snapshot.sprints) {
    if (text(sprint.startDate) === null || text(sprint.endDate) === null) {
      knownSprints.delete(sprint.id);
    }
  }

  // ── Elementi e le loro tre storie ──────────────────────────────────────────
  const workItems: unknown[] = [];
  const transitions: unknown[] = [];
  const estimateChanges: unknown[] = [];
  const scopeEvents: unknown[] = [];
  const comments: unknown[] = [];

  /** Position in the backlog, handed out only to what is still in the backlog. */
  let backlogPosition = 0;

  for (const issue of snapshot.issues) {
    const itemId = jiraId("item", issue.id);
    const createdAt = instant(issue.fields.created);

    const currentState =
      mapState(issue.fields.status.name, issue.fields.status.statusCategory?.key) ?? "todo";

    const currentEstimate =
      storyPointsFieldId === null
        ? null
        : parsePoints(numberish(issue.customFields[storyPointsFieldId]));

    const entries = orderedChangelog(issue);

    // Lo sprint di adesso: l'ultimo di quelli a cui l'elemento appartiene.
    const currentSprints = issue.fields.sprintIds.filter((id) => knownSprints.has(id));
    const currentSprintId = currentSprints[currentSprints.length - 1] ?? null;

    const inBacklog = currentSprintId === null && currentState !== "done";

    workItems.push(
      workItemSchema.parse({
        id: itemId,
        ...scope,
        ...source,
        sourceId: issue.key,
        kind: config.kindMapping[issue.fields.issuetype.name] ?? "task",
        title: issue.fields.summary,
        description: text(issue.fields.description),
        state: currentState,
        estimate: currentEstimate,
        backlogOrder: inBacklog ? backlogPosition++ : null,
        howToDemo:
          howToDemoFieldId === null
            ? null
            : text(numberish(issue.customFields[howToDemoFieldId])),
        sprintId: currentSprintId === null ? null : jiraId("sprint", String(currentSprintId)),
        assigneeId: remember(issue.fields.assignee),
        sourceCreatedAt: createdAt,
        parentId: issue.fields.parent ? jiraId("item", issue.fields.parent.id) : null,
        ...audit(asOf),
      }),
    );

    // ── Storia degli stati ───────────────────────────────────────────────────
    const statusChanges = entries.flatMap((entry) =>
      entry.items
        .filter((change) => change.field === "status")
        .map((change) => ({ entry, change })),
    );

    const firstStatus = statusChanges[0];
    let state =
      (firstStatus ? mapState(firstStatus.change.fromString) : null) ?? currentState;

    transitions.push(
      stateTransitionSchema.parse({
        id: jiraId("transition", `${issue.id}:created`),
        ...scope,
        ...source,
        sourceId: `${issue.key}:created`,
        workItemId: itemId,
        fromState: null,
        toState: state,
        occurredAt: createdAt,
        actorId: null,
        ...audit(asOf),
      }),
    );

    for (const { entry, change } of statusChanges) {
      const next = mapState(change.toString);
      if (next === null || next === state) continue;

      transitions.push(
        stateTransitionSchema.parse({
          id: jiraId("transition", `${issue.id}:${entry.id}`),
          ...scope,
          ...source,
          sourceId: `${issue.key}:${entry.id}:status`,
          workItemId: itemId,
          fromState: state,
          toState: next,
          occurredAt: instant(entry.created),
          actorId: remember(entry.author),
          ...audit(asOf),
        }),
      );

      state = next;
    }

    // ── Storia delle stime ───────────────────────────────────────────────────
    const estimateEdits =
      storyPointsFieldId === null
        ? []
        : entries.flatMap((entry) =>
            entry.items
              .filter((change) => change.fieldId === storyPointsFieldId)
              .map((change) => ({ entry, change })),
          );

    const firstEstimate = estimateEdits[0];
    let estimate = firstEstimate
      ? parsePoints(firstEstimate.change.from ?? firstEstimate.change.fromString)
      : currentEstimate;

    estimateChanges.push(
      estimateChangeSchema.parse({
        id: jiraId("estimate", `${issue.id}:created`),
        ...scope,
        ...source,
        sourceId: `${issue.key}:created`,
        workItemId: itemId,
        fromEstimate: null,
        toEstimate: estimate,
        occurredAt: createdAt,
        actorId: null,
        ...audit(asOf),
      }),
    );

    for (const { entry, change } of estimateEdits) {
      const next = parsePoints(change.to ?? change.toString);
      if (sameEstimate(next, estimate)) continue;

      estimateChanges.push(
        estimateChangeSchema.parse({
          id: jiraId("estimate", `${issue.id}:${entry.id}`),
          ...scope,
          ...source,
          sourceId: `${issue.key}:${entry.id}:estimate`,
          workItemId: itemId,
          fromEstimate: estimate,
          toEstimate: next,
          occurredAt: instant(entry.created),
          actorId: remember(entry.author),
          ...audit(asOf),
        }),
      );

      estimate = next;
    }

    // ── Ingressi e uscite dagli sprint ───────────────────────────────────────
    const sprintEdits = entries.flatMap((entry) =>
      entry.items
        .filter((change) => change.field === "Sprint")
        .map((change) => ({ entry, change })),
    );

    /*
     * Il campo Sprint contiene una **lista**, e leggerla come un valore singolo
     * è l'errore che si paga sul caso che più ci interessa.
     *
     * Jira scrive `from: "12, 13"` → `to: "12"` quando una storia esce da uno
     * sprint restando nell'altro. Prendere `to` come «lo sprint di adesso»
     * direbbe che è entrata nel 12, che è falso: nel 12 c'era già. Si guarda la
     * differenza fra i due insiemi, e ne esce un solo evento — l'uscita dal 13.
     */
    for (const { entry, change } of sprintEdits) {
      const before = new Set(parseSprintList(change.from ?? change.fromString));
      const after = new Set(parseSprintList(change.to ?? change.toString));
      const at = instant(entry.created);

      for (const id of after) {
        if (before.has(id) || !knownSprints.has(id)) continue;
        scopeEvents.push(
          scopeEvent(scope, asOf, issue, itemId, id, "added", at, entry.id),
        );
      }

      for (const id of before) {
        if (after.has(id) || !knownSprints.has(id)) continue;
        scopeEvents.push(
          scopeEvent(scope, asOf, issue, itemId, id, "removed", at, entry.id),
        );
      }
    }

    /*
     * Nessuna voce nel changelog e l'elemento è comunque in uno sprint.
     *
     * Succede quando l'issue è stata creata già dentro allo sprint: non c'è
     * stato alcun cambiamento da registrare. L'ingresso si data alla creazione,
     * che è quando è avvenuto.
     */
    if (sprintEdits.length === 0) {
      for (const id of currentSprints) {
        scopeEvents.push(
          scopeEvent(scope, asOf, issue, itemId, id, "added", createdAt, "created"),
        );
      }
    }

    // ── Commenti ─────────────────────────────────────────────────────────────
    for (const comment of issue.comments) {
      comments.push(
        commentSchema.parse({
          id: jiraId("comment", comment.id),
          ...scope,
          ...source,
          sourceId: comment.id,
          workItemId: itemId,
          authorId: remember(comment.author),
          // Contenuto non fidato (§8.1): è un dato, mai un'istruzione.
          body: comment.body.slice(0, 20_000),
          postedAt: instant(comment.created),
          ...audit(asOf),
        }),
      );
    }
  }

  // ── Lavagna ────────────────────────────────────────────────────────────────
  const boardId = jiraId("board", String(config.boardId));

  const board = boardSchema.parse({
    id: boardId,
    ...scope,
    ...source,
    sourceId: String(config.boardId),
    name: snapshot.boardName,
    ...audit(asOf),
  });

  /*
   * Le colonne sono la mappatura degli stati, non una lettura della board.
   *
   * Jira espone la configurazione delle colonne da un altro endpoint, e
   * leggerlo darebbe i nomi giusti a costo di una seconda fonte di verità sulla
   * corrispondenza fra colonna e stato. Derivarle dalla mappatura dichiarata
   * dal progetto tiene una sola fonte: se le due divergessero, nessuno saprebbe
   * quale credere.
   */
  const boardColumns = Object.entries(config.stateMapping).map(([name, state], position) =>
    boardColumnSchema.parse({
      id: jiraId("column", `${config.boardId}:${name}`),
      ...scope,
      ...source,
      sourceId: `${config.boardId}:${name}`,
      boardId,
      name,
      state,
      position,
      wipLimit: null,
      ...audit(asOf),
    }),
  );

  const people = [...users.values()].map((user) =>
    personSchema.parse({
      id: jiraId("person", user.accountId),
      ...scope,
      ...source,
      sourceId: user.accountId,
      displayName: user.displayName,
      email: text(user.emailAddress),
      ...audit(asOf),
    }),
  );

  return {
    batch: {
      ...EMPTY_BATCH,
      people,
      boards: [board],
      boardColumns,
      sprints,
      workItems: workItems as CanonicalBatch["workItems"],
      transitions: transitions as CanonicalBatch["transitions"],
      estimateChanges: estimateChanges as CanonicalBatch["estimateChanges"],
      scopeEvents: scopeEvents as CanonicalBatch["scopeEvents"],
      comments: comments as CanonicalBatch["comments"],
    },
    unmappedStatuses: [...unmapped].sort(),
  };
}

function scopeEvent(
  scope: { readonly organizationId: string; readonly projectId: string },
  asOf: Date,
  issue: JiraIssue,
  itemId: string,
  sprintId: number,
  kind: "added" | "removed",
  occurredAt: Date,
  entryId: string,
): unknown {
  return sprintScopeEventSchema.parse({
    ...scope,
    sourceSystem: SYSTEM,
    sourceId: `${issue.key}:${entryId}:${kind}:${sprintId}`,
    sprintId: jiraId("sprint", String(sprintId)),
    workItemId: itemId,
    kind,
    /*
     * Sempre `null`, e non è una scorciatoia.
     *
     * Jira non distingue un'aggiunta voluta da un'interruzione: registra che
     * qualcosa è entrato, non perché. Il terzo stato del modello — «non
     * dichiarato» — esiste esattamente per questo (ADR-0009), e riempirlo con
     * un valore inventato farebbe risultare pianificata ogni interruzione.
     */
    reason: null,
    occurredAt,
    createdAt: asOf,
    updatedAt: asOf,
  });
}

/** The field identifier behind a human name, or `null` if the instance has none. */
function findFieldId(snapshot: JiraSnapshot, names: readonly string[]): string | null {
  for (const name of names) {
    const match = snapshot.fields.find(
      (field) => field.name.toLowerCase() === name.toLowerCase(),
    );
    if (match) return match.id;
  }

  return null;
}

/** A custom field value as a string, whatever Jira decided to put in it. */
function numberish(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;

  return null;
}
