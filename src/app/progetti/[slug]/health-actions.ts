"use server";

import { organizationIdSchema, projectIdSchema, type HealthNarrative } from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent } from "@/lib/agents/scrum-agent";
import { runSprintHealthNarration } from "@/lib/agents/sprint-health-runtime";

/**
 * Asking the Scrum Master AI to explain the verdict on screen.
 *
 * **Why this returns its result instead of revalidating a page.** The narration
 * is not stored: it describes the state of this minute, and keeping it would
 * produce, within a day, a confident description of a situation that is no
 * longer true. So there is nothing for a page to reload — the text exists only
 * as the answer to this request, and travels back as one.
 *
 * A refusal comes back the same way, with its reason. «Non è stato possibile»
 * tells a reader nothing about whether to retry, to fix a configuration, or to
 * stop asking.
 */

export type NarrationState =
  | { readonly status: "idle" }
  | { readonly status: "ok"; readonly narrative: HealthNarrative }
  | { readonly status: "refused"; readonly message: string };

/**
 * The demonstration answer for the deterministic provider.
 *
 * It quotes no figure and anchors to no signal, and both are deliberate: which
 * signals are measurable depends on the project's data, so a canned answer
 * naming one would be refused on exactly the projects where the data is thin.
 * A demonstration that fails where the product is weakest demonstrates nothing.
 *
 * `trend` is absent, because a stub cannot know whether any earlier check
 * exists — and claiming one is the specific failure this skill refuses.
 */
const DEMO_ANSWER = JSON.stringify({
  situation:
    "Il giudizio riportato qui sopra è stato calcolato dal codice a partire dai segnali elencati. " +
    "Questa spiegazione arriva dal provider dimostrativo, che non dispone di un modello linguistico: " +
    "descrive il meccanismo senza aggiungere una lettura dei numeri.",
  observations: [],
});

export async function narrateHealthAction(
  _previous: NarrationState,
  form: FormData,
): Promise<NarrationState> {
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

  const outcome = await runSprintHealthNarration({
    organizationId,
    projectId,
    agent: loaded.agent,
    options: { runsToday, stubResponse: DEMO_ANSWER },
  });

  return outcome.ok && outcome.narrative
    ? { status: "ok", narrative: outcome.narrative }
    : { status: "refused", message: outcome.message };
}
