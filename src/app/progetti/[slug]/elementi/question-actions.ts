"use server";

import { organizationIdSchema, projectIdSchema, type ProjectAnswer } from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent } from "@/lib/agents/scrum-agent";
import { runProjectQuestion, type CitedSource } from "@/lib/agents/project-qa-runtime";

/**
 * Asking a free question about the project.
 *
 * The answer travels back with the sources it was built from, because it is the
 * only output of this product with no figures beside it on screen: without the
 * links it would have to be believed rather than checked.
 */

export type QuestionState =
  | { readonly status: "idle" }
  | {
      readonly status: "ok";
      readonly answer: ProjectAnswer;
      readonly sources: readonly CitedSource[];
      readonly question: string;
    }
  | { readonly status: "refused"; readonly message: string };

export async function askProjectAction(
  _previous: QuestionState,
  form: FormData,
): Promise<QuestionState> {
  const session = await auth();
  if (!session?.organizationId) {
    return { status: "refused", message: "Sessione scaduta: rientra e riprova." };
  }

  const slug = form.get("slug");
  const question = form.get("question");

  if (typeof slug !== "string" || typeof question !== "string") {
    return { status: "refused", message: "Domanda non ricevuta." };
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

  const outcome = await runProjectQuestion({
    organizationId,
    projectId,
    agent: loaded.agent,
    question,
    options: { runsToday },
  });

  return outcome.ok && outcome.answer
    ? {
        status: "ok",
        answer: outcome.answer,
        sources: outcome.sources,
        question: question.trim(),
      }
    : { status: "refused", message: outcome.message };
}
