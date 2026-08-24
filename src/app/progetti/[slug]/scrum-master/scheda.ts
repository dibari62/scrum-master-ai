import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import {
  metricSnapshotSchema,
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  reportContentSchema,
  reportOriginSchema,
  type MetricSnapshot,
  type Project,
  type ReportContent,
  type ReportOrigin,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent, mayConfigureAgent } from "@/lib/agents/scrum-agent";

/**
 * Everything the four screens of the Scrum Master AI card share.
 *
 * **Why the card became four screens.** It had grown into one page answering
 * four unrelated questions at once — what it can do, what it produced, how it
 * is configured, what it executed — and the reader had to work out which
 * paragraph belonged to which question. Splitting it moves that work from the
 * reader to the address bar.
 *
 * Wrapped in React's `cache` so the layout and the page inside it do not each
 * open the same queries: within one request the second call returns the first
 * one's result. Without it, adding a shared header would have doubled the
 * database round trips on every screen.
 */

export type ReportEntry = {
  readonly id: string;
  readonly sprintId: string;
  readonly origin: ReportOrigin;
  readonly content: ReportContent;
  readonly snapshot: MetricSnapshot;
  readonly generatedAt: Date;
};

/** A report, with how many superseded versions of it are still kept. */
export type ReportWithHistory = {
  readonly report: ReportEntry;
  readonly earlier: number;
};

export const loadScheda = cache(async (slug: string) => {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) notFound();

  const project: Project = projectSchema.parse(projectRow);
  const projectId = projectIdSchema.parse(project.id);

  const loaded = await loadAgent(organizationId, projectId);
  // No agent yet: the wizard is the whole screen, and it lives outside this
  // group precisely so it does not inherit a layout describing an agent that
  // does not exist.
  if (!loaded) redirect(`/progetti/${slug}/scrum-master/crea`);

  return {
    slug,
    project,
    projectId,
    scope,
    agent: loaded.agent,
    context: loaded.context,
    canConfigure: mayConfigureAgent(session.role),
    reportSkillEnabled: loaded.agent.enabledSkillKeys.includes("sprint-report"),
  };
});

/**
 * The sprints of the project, split into the two groups the card cares about.
 *
 * Closed ones are ordered most recent first: a report is almost always asked
 * for about the sprint that just ended.
 */
export const loadSprints = cache(async (slug: string) => {
  const { scope, projectId } = await loadScheda(slug);
  const rows = await scope.reads.sprintsByProject(projectId);

  const closed = rows
    .filter((sprint) => sprint.completedAt !== null)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());

  return { all: rows, closed, latestClosed: closed[0] };
});

/**
 * The reports, keeping one card per sprint.
 *
 * Regenerating adds a report rather than replacing the previous one (spec §11
 * Q3): deleting is irreversible and accumulating is not. Showing them all,
 * however, filled the screen with cards telling the same sprint with the same
 * figures — which reads as duplicated data rather than as history. The most
 * recent one per sprint is kept, and each says how many earlier versions
 * remain, so what is not shown is still stated instead of vanishing.
 */
export const loadReports = cache(async (slug: string) => {
  const { scope, projectId } = await loadScheda(slug);
  const rows = await scope.reads.sprintReportsByProject(projectId);

  const latestPerSprint: ReportWithHistory[] = [];
  const bySprint = new Map<string, { report: ReportEntry; earlier: number }>();

  for (const row of rows) {
    const report: ReportEntry = {
      id: row.id,
      sprintId: row.sprintId,
      origin: reportOriginSchema.parse(row.origin),
      content: reportContentSchema.parse(row.content),
      snapshot: metricSnapshotSchema.parse(row.snapshot),
      generatedAt: row.generatedAt,
    };

    // `rows` arrives newest first.
    const seen = bySprint.get(report.sprintId);
    if (seen) {
      seen.earlier += 1;
      continue;
    }

    const entry = { report, earlier: 0 };
    bySprint.set(report.sprintId, entry);
    latestPerSprint.push(entry as ReportWithHistory);
  }

  return { latestPerSprint, bySprint };
});

/** The runs, newest first, straight from the shared tenant-scoped read. */
export const loadRuns = cache(async (slug: string) => {
  const { scope, projectId } = await loadScheda(slug);
  return scope.reads.skillRunsByProject(projectId);
});
