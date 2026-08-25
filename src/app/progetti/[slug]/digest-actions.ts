"use server";

import { organizationIdSchema, projectIdSchema, type DigestNarrative } from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent } from "@/lib/agents/scrum-agent";
import { runDailyDigest } from "@/lib/agents/daily-digest-runtime";
import type { NarrationOrigin } from "@/agents/sprint-health";

/**
 * Asking the Scrum Master AI to write up the previous day.
 *
 * Not stored, like the other narrations: a digest kept past its day becomes a
 * confident statement about a situation that has moved on. What *is* kept is the
 * run, in the register, with what it cost.
 */

export type DigestState =
  | { readonly status: "idle" }
  | {
      readonly status: "ok";
      readonly narrative: DigestNarrative;
      readonly origin: NarrationOrigin;
    }
  | { readonly status: "refused"; readonly message: string };

export async function requestDigestAction(
  _previous: DigestState,
  form: FormData,
): Promise<DigestState> {
  const session = await auth();
  if (!session?.organizationId) {
    return { status: "refused", message: "Sessione scaduta: rientra e riprova." };
  }

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "refused", message: "Progetto non indicato." };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) return { status: "refused", message: "Progetto non trovato." };

  const projectId = projectIdSchema.parse(project.id);
  const loaded = await loadAgent(organizationId, projectId);

  if (!loaded) {
    return {
      status: "refused",
      message: "Questo progetto non ha ancora uno Scrum Master AI.",
    };
  }

  const runs = await scope.reads.skillRunsByProject(projectId);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const runsToday = runs.filter(
    (run) =>
      run.scrumAgentId === loaded.agent.id && run.startedAt.getTime() >= startOfDay.getTime(),
  ).length;

  const outcome = await runDailyDigest({
    organizationId,
    projectId,
    agent: loaded.agent,
    options: { runsToday },
  });

  return outcome.ok && outcome.narrative && outcome.origin
    ? { status: "ok", narrative: outcome.narrative, origin: outcome.origin }
    : { status: "refused", message: outcome.message };
}
