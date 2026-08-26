import type { WorkItem, WorkItemId } from "@/domain";

/**
 * The book's numeric guidelines: **warnings, not constraints**.
 *
 * The text calls them guidelines and never rules, and the difference is the
 * whole design. A sprint with four stories is not invalid — it is worth a
 * second look, because the usual cause is stories too big to finish. Turning a
 * guideline into a block would teach a team to game the count.
 *
 * Two of the three are here. The third, "tech stories should take 10-20% of
 * capacity" (pag. 47), is **not implementable today** and is deliberately
 * absent rather than approximated: the canonical model has no way to say that
 * an item serves the codebase rather than a user. Reading it off `kind` would
 * be wrong — a `task` in Scrum is a piece of a story, not a technical story —
 * and a guideline computed from the wrong set is worse than an absent one,
 * because it looks like an answer.
 *
 * Pure and I/O-free like the rest of the engine, and it never reads the clock.
 */

/**
 * > «We normally strive for stories weighted **two to eight** man-days» (pag. 43)
 *
 * Below two the story is small enough that tracking it costs more than doing
 * it; above eight the estimate is a guess wearing a number.
 */
export const MIN_STORY_POINTS = 2;
export const MAX_STORY_POINTS = 8;

/**
 * > Between **5 and 15** stories per sprint (pag. 43)
 *
 * Fewer than five usually means the stories are too big to finish; more than
 * fifteen usually means the team took on more than it can carry.
 */
export const MIN_STORIES_PER_SPRINT = 5;
export const MAX_STORIES_PER_SPRINT = 15;

/** Which side of the guideline a value falls on. */
export type GuidelineDirection = "below" | "above";

export interface StorySizeDeviation {
  readonly itemId: WorkItemId;
  readonly title: string;
  readonly points: number;
  readonly direction: GuidelineDirection;
}

export interface PlanningGuidelines {
  /**
   * Stories the size guideline could judge: a story, estimated, in points.
   *
   * Not the number of items. A bug and a spike are not stories, and an
   * unestimated story has no size to compare — counting them would make the
   * proportion of deviations depend on what else the sprint happens to hold.
   */
  readonly storiesSized: number;

  readonly storySize: readonly StorySizeDeviation[];

  /** Every story in the sprint, estimated or not: the count is of stories. */
  readonly storyCount: number;

  /**
   * Which side of 5–15 the count falls on, or `null` when it is inside.
   *
   * Also `null` for a sprint with **no stories at all**. Zero is below five,
   * but "too few stories" would be a planning smell, and an empty sprint is a
   * missing plan or missing data — a different problem, and saying the wrong
   * one out loud sends the reader to look in the wrong place.
   */
  readonly storyCountDirection: GuidelineDirection | null;
}

/**
 * Checks one sprint's contents against the two guidelines the model supports.
 *
 * The caller passes the items of a single sprint: the count guideline is about
 * a sprint, and handing this function a whole project would produce a number
 * that means nothing.
 *
 * Order follows the input, so the same data always produces the same list.
 */
export function planningGuidelines(items: readonly WorkItem[]): PlanningGuidelines {
  const storySize: StorySizeDeviation[] = [];
  let storiesSized = 0;
  let storyCount = 0;

  for (const item of items) {
    if (item.kind !== "story") continue;

    storyCount += 1;

    const { estimate } = item;
    // Points only: the guideline is "two to eight", and two *hours* is a
    // different statement about a different quantity.
    if (estimate === null || estimate.unit !== "points") continue;

    storiesSized += 1;

    if (estimate.value < MIN_STORY_POINTS) {
      storySize.push({
        itemId: item.id,
        title: item.title,
        points: estimate.value,
        direction: "below",
      });
    } else if (estimate.value > MAX_STORY_POINTS) {
      storySize.push({
        itemId: item.id,
        title: item.title,
        points: estimate.value,
        direction: "above",
      });
    }
  }

  return {
    storiesSized,
    storySize,
    storyCount,
    storyCountDirection: storyCountDirection(storyCount),
  };
}

function storyCountDirection(count: number): GuidelineDirection | null {
  if (count === 0) return null;
  if (count < MIN_STORIES_PER_SPRINT) return "below";
  if (count > MAX_STORIES_PER_SPRINT) return "above";
  return null;
}
