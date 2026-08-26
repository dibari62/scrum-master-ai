import {
  improvementActionSchema,
  mayShowVotes,
  projectSchema,
  retrospectiveNoteSchema,
  retrospectiveSchema,
  sprintSchema,
  type ImprovementAction,
  type OrganizationId,
  type Project,
  type Retrospective,
  type RetrospectiveNote,
  type Sprint,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import {
  improvementFollowUp,
  improvementLeadTime,
  improvementsByPriority,
  type ImprovementFollowUp,
  type MetricResult,
  type Milliseconds,
} from "@/metrics";

/**
 * The retrospectives of a project, and whether they changed anything.
 *
 * **The second half is the point.** A screen that only listed what was said at
 * each meeting would be a nicer way of forgetting: the book's own advice —
 * «Focus on just a few improvements per sprint» — is only meaningful if
 * somebody later checks whether those few happened.
 *
 * Server-side only, tenant-scoped through the shared helper (§8.4).
 */

export type RetrospectiveEntry = {
  readonly retrospective: Retrospective;
  /** The sprint looked back on. `null` if it has since been removed. */
  readonly sprint: Sprint | null;
  readonly good: readonly RetrospectiveNote[];
  readonly couldHaveDoneBetter: readonly RetrospectiveNote[];
  /** Ordered by votes, as on the wall. */
  readonly improvements: readonly ImprovementAction[];
  /**
   * Whether vote totals may be shown for this meeting.
   *
   * Decided here rather than in the view so the rule from §8.2 lives in one
   * place: with two people in the room a total tells you how each of them
   * voted, and an aggregate that identifies individuals is not an aggregate.
   */
  readonly showVotes: boolean;
};

export type ProjectRetrospectives = {
  readonly project: Project;
  readonly entries: readonly RetrospectiveEntry[];
  /** Across every retrospective: what is still open, and for how long. */
  readonly followUp: MetricResult<ImprovementFollowUp>;
  /** Average time from decision to resolution, over the closed ones. */
  readonly leadTime: MetricResult<Milliseconds>;
  /**
   * Sprints that closed without a retrospective.
   *
   * Reported rather than passed over: a sprint with no retrospective is a real
   * fact about a team, and a page that simply omitted it would let the habit
   * disappear quietly.
   */
  readonly sprintsWithout: readonly Sprint[];
};

export async function loadProjectRetrospectives(
  organizationId: OrganizationId,
  slug: string,
  asOf: Date,
): Promise<ProjectRetrospectives | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [retrospectiveRows, noteRows, actionRows, sprintRows] = await Promise.all([
    scope.reads.retrospectivesByProject(project.id),
    scope.reads.retrospectiveNotesByProject(project.id),
    scope.reads.improvementActionsByProject(project.id),
    scope.reads.sprintsByProject(project.id),
  ]);

  const retrospectives = retrospectiveRows.map((row) => retrospectiveSchema.parse(row));
  const notes = noteRows.map((row) => retrospectiveNoteSchema.parse(row));
  const actions = actionRows.map((row) => improvementActionSchema.parse(row));
  const sprints = sprintRows.map((row) => sprintSchema.parse(row));

  const sprintById = new Map(sprints.map((sprint) => [sprint.id, sprint]));

  // Il più recente in cima: è quello di cui si parla, e scorrere fino in fondo
  // per trovarlo è il difetto che questa pagina non deve avere.
  const ordered = [...retrospectives].sort(
    (a, b) => b.heldAt.getTime() - a.heldAt.getTime(),
  );

  const entries = ordered.map((retrospective): RetrospectiveEntry => {
    const own = notes.filter((note) => note.retrospectiveId === retrospective.id);

    return {
      retrospective,
      sprint: sprintById.get(retrospective.sprintId) ?? null,
      good: own.filter((note) => note.column === "good"),
      couldHaveDoneBetter: own.filter(
        (note) => note.column === "could-have-done-better",
      ),
      improvements: improvementsByPriority(actions, retrospective),
      showVotes: mayShowVotes(retrospective),
    };
  });

  const withRetrospective = new Set(retrospectives.map((entry) => entry.sprintId));

  return {
    project,
    entries,
    followUp: improvementFollowUp(actions, asOf),
    leadTime: improvementLeadTime(actions),
    sprintsWithout: sprints
      // Solo gli sprint **chiusi**: su uno ancora aperto la retrospettiva non
      // manca, semplicemente non è ancora il momento.
      .filter((sprint) => sprint.completedAt !== null)
      .filter((sprint) => !withRetrospective.has(sprint.id))
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
  };
}
