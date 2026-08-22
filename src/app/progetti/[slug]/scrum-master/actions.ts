"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { organizationIdSchema, projectIdSchema } from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { createAgent, loadAgent, parseWizardForm } from "@/lib/agents/scrum-agent";
import { runConfigurationCheck } from "@/lib/agents/runtime";

/**
 * Server actions for the Scrum Master AI.
 *
 * Thin on purpose: every decision lives in `src/lib/agents`, which is plain
 * functions and therefore testable. A server action cannot be called by a test
 * — its identifier is generated at build time — so anything that matters must
 * not live here.
 *
 * The tenant comes from the session and the project from the address. Neither
 * is ever read from the submitted form: a body that could name an organization
 * is the shape of bug §8.4 exists to prevent.
 */

export type WizardState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string };

export async function createAgentAction(
  _previous: WizardState,
  form: FormData,
): Promise<WizardState> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "error", message: "Progetto non indicato." };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) return { status: "error", message: "Progetto non trovato." };

  const payload = parseWizardForm(form);
  if (!payload) {
    return {
      status: "error",
      message: "La configurazione non è valida. Controlla il nome e la durata dello sprint.",
    };
  }

  const outcome = await createAgent({
    organizationId,
    projectId: projectIdSchema.parse(project.id),
    role: session.role,
    payload,
  });

  if (!outcome.ok) return { status: "error", message: outcome.message };

  // The project page shows whether an agent exists; without this it would keep
  // offering to create one that now exists.
  revalidatePath(`/progetti/${slug}`);
  redirect(`/progetti/${slug}/scrum-master`);
}

export async function runConfigurationCheckAction(form: FormData): Promise<void> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") redirect("/progetti");

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) redirect("/progetti");

  const projectId = projectIdSchema.parse(project.id);
  const loaded = await loadAgent(organizationId, projectId);
  if (!loaded) redirect(`/progetti/${slug}`);

  /*
   * The daily cap is counted, not guessed.
   *
   * Reading the register is the only way to know: a counter held in memory
   * would reset on every deployment, and on a serverless platform there is no
   * single process to hold it in.
   */
  const runs = await scope.reads.skillRunsByProject(projectId);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const runsToday = runs.filter(
    (run) =>
      run.scrumAgentId === loaded.agent.id && run.startedAt.getTime() >= startOfDay.getTime(),
  ).length;

  await runConfigurationCheck({
    organizationId,
    projectId,
    agent: loaded.agent,
    options: { runsToday },
  });

  revalidatePath(`/progetti/${slug}/scrum-master`);
}
