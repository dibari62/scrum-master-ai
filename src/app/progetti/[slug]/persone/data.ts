import {
  personSchema,
  projectSchema,
  type OrganizationId,
  type Project,
  type SourceSystem,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";

/**
 * The people a project's data mentions — the register, and nothing else.
 *
 * **The most important thing about this file is what it does not return.**
 * §8.2 forbids individual performance metrics: no per-person item count, no
 * ranking, no personal velocity, no inference about how someone is feeling.
 * The rule could have been respected by simply not writing those queries, but a
 * rule respected by habit is a rule that lasts until somebody is in a hurry.
 *
 * So it is respected by shape instead. This loader projects each row onto the
 * fields below and hands nothing else to the page. Work items, transitions and
 * comments are never read here, so no amount of editing the page can produce a
 * figure about a person: the data would have to be fetched first, and fetching
 * it means coming back to this file and writing that query on purpose.
 *
 * Server-side only, tenant-scoped through the shared helper like every other
 * read in the application (§8.4).
 *
 * The register is thin on purpose. The `people` table holds a display name, an
 * optional address and where the record came from — no role, no active flag, no
 * joining date. Those columns are not missing by oversight and are not to be
 * added to give this page something to show: a column earns its place when
 * something needs the fact, not when a layout looks empty.
 */

export type PersonEntry = {
  readonly id: string;
  readonly displayName: string;
  /** `null` when the source does not expose one. Contact detail, not identity. */
  readonly email: string | null;
  /** Which connector brought the record in: the provenance of what is shown. */
  readonly source: SourceSystem;
};

export type ProjectPeople = {
  readonly project: Project;
  readonly people: readonly PersonEntry[];
  /**
   * How many of them carry an address.
   *
   * Counted here rather than in the page for the usual reason — the page
   * formats, it does not compute — and shown at all because it is a fact about
   * how complete the *source* is, not about how anybody is doing. It answers
   * "can this project attribute a comment to a real mailbox", which is the
   * question the register exists to serve.
   */
  readonly withEmail: number;
};

export async function loadProjectPeople(
  organizationId: OrganizationId,
  slug: string,
): Promise<ProjectPeople | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  // Already alphabetical: the ordering lives in the shared read, where it also
  // documents why the order must not come from the data (§8.2).
  const personRows = await scope.reads.peopleByProject(project.id);

  const people = personRows.map((row): PersonEntry => {
    // Parsed rather than trusted: the database returns rows, and a schema is
    // the only thing that guarantees their shape (R4).
    const person = personSchema.parse(row);

    return {
      id: person.id,
      displayName: person.displayName,
      email: person.email,
      source: person.sourceSystem,
    };
  });

  return {
    project,
    people,
    withEmail: people.filter((person) => person.email !== null).length,
  };
}
