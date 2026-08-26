import { describe, expect, it } from "vitest";

import {
  estimateChangeSchema,
  stateTransitionSchema,
  workItemSchema,
  type Estimate,
  type EstimateChange,
  type StateTransition,
  type WorkItem,
  type WorkItemKind,
  type WorkItemState,
} from "@/domain";

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";
const WORK_ITEM_ID = "1b4e28ba-2fa1-4d3b-a3f5-cc9f8d3a1b77";

const SCOPE = {
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  sourceSystem: "seed",
} as const;

/**
 * Builders for metric tests.
 *
 * Timestamps are written as plain ISO strings so a test reads like the story it
 * describes; anything computed would make the expected numbers unverifiable by
 * eye, which defeats the purpose of testing arithmetic.
 */

let counter = 0;

/** A deterministic UUID, so ordering tie-breaks are reproducible across runs. */
function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export function resetIds(): void {
  counter = 0;
}

/**
 * A valid UUID built from a short readable name.
 *
 * Tests read better with `uuidFor("trascinato")` than with a row of hex, and the
 * mapping is deterministic so two runs agree. The schema demands a UUID and
 * rightly refuses anything else; this satisfies it without making the test
 * unreadable.
 */
export function uuidFor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;

  const hex = hash.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-${hex.padStart(12, "0")}`;
}

export function move(
  fromState: WorkItemState | null,
  toState: WorkItemState,
  occurredAt: string,
  options: { readonly id?: string; readonly workItemId?: string } = {},
): StateTransition {
  const id = options.id ?? nextId();

  return stateTransitionSchema.parse({
    id,
    ...SCOPE,
    sourceId: `t-${id}`,
    workItemId: options.workItemId ?? WORK_ITEM_ID,
    fromState,
    toState,
    occurredAt,
    actorId: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

export function item(
  overrides: Partial<{
    id: string;
    title: string;
    sourceCreatedAt: string;
    kind: WorkItemKind;
    state: WorkItemState;
    estimate: { value: number; unit: "points" | "hours" } | null;
    sprintId: string | null;
  }> = {},
): WorkItem {
  return workItemSchema.parse({
    id: overrides.id ?? WORK_ITEM_ID,
    ...SCOPE,
    sourceId: `i-${overrides.id ?? WORK_ITEM_ID}`,
    kind: overrides.kind ?? "story",
    title: overrides.title ?? "Elemento di prova",
    description: null,
    state: overrides.state ?? "todo",
    estimate: overrides.estimate === undefined ? { value: 3, unit: "points" } : overrides.estimate,
    sprintId: overrides.sprintId ?? null,
    assigneeId: null,
    sourceCreatedAt: overrides.sourceCreatedAt ?? "2026-04-06T08:00:00.000Z",
    parentId: null,
    createdAt: overrides.sourceCreatedAt ?? "2026-04-06T08:00:00.000Z",
    updatedAt: overrides.sourceCreatedAt ?? "2026-04-06T08:00:00.000Z",
  });
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/**
 * A change to an item's estimate.
 *
 * Written with both ends explicit — where it came from and where it went — so a
 * test reads as the story it describes. The `from` half is what makes an
 * incoherent history visible to a reader: a change claiming to start at 5 in an
 * item that was at 8 is wrong on the page, not only in an assertion.
 */
export function estimateChange(
  workItemId: string,
  fromEstimate: Estimate | null,
  toEstimate: Estimate | null,
  occurredAt: string,
): EstimateChange {
  const id = nextId();

  return estimateChangeSchema.parse({
    id,
    ...SCOPE,
    sourceId: `e-${id}`,
    workItemId,
    fromEstimate,
    toEstimate,
    occurredAt,
    actorId: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

/** Guard that narrows an available result, so tests read without casts. */
export function expectAvailable<T>(
  result: { available: boolean } & Record<string, unknown>,
): T {
  expect(result.available, `metrica non disponibile: ${String(result["reason"])}`).toBe(true);
  return result["value"] as T;
}

describe("costruttori di prova", () => {
  it("producono identificativi distinti e ordinabili", () => {
    resetIds();
    const first = move(null, "todo", "2026-04-06T09:00:00.000Z");
    const second = move("todo", "in_progress", "2026-04-06T10:00:00.000Z");

    expect(first.id).not.toBe(second.id);
    expect(first.id < second.id).toBe(true);
  });
});
