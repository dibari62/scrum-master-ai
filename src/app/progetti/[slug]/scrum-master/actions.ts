"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isKnownSkillKey,
  isSkillAvailable,
  organizationIdSchema,
  projectIdSchema,
  sprintIdSchema,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { createAgent, loadAgent, mayConfigureAgent, parseWizardForm } from "@/lib/agents/scrum-agent";
import { runConfigurationCheck } from "@/lib/agents/runtime";
import { runSprintReport } from "@/lib/agents/sprint-report-runtime";

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

export async function runConfigurationCheckAction(form: FormData): Promise<void> {  const session = await auth();
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

/**
 * Enables or disables a capability on this project's agent.
 *
 * T3 shipped `enabledSkillKeys` with nothing able to set it, so the card
 * announced a decision nobody could take. With a real skill to enable, the
 * announcement becomes a control.
 */
export async function setSkillEnabledAction(form: FormData): Promise<void> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  const key = form.get("skillKey");
  if (typeof slug !== "string" || typeof key !== "string") redirect("/progetti");

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) redirect("/progetti");

  const projectId = projectIdSchema.parse(project.id);
  const loaded = await loadAgent(organizationId, projectId);
  if (!loaded) redirect(`/progetti/${slug}`);

  // Only an administrator configures the agent (spec Q4), and the check lives
  // here as well as in the interface: a hidden button is not an authorisation.
  if (!mayConfigureAgent(session.role)) redirect(`/progetti/${slug}/scrum-master`);

  // Only a key the catalogue knows and this release can run. Anything else
  // would write a value that `isSkillAvailable` will refuse later anyway.
  if (!isKnownSkillKey(key) || !isSkillAvailable(key)) {
    redirect(`/progetti/${slug}/scrum-master`);
  }

  const enabled = new Set(loaded.agent.enabledSkillKeys);
  if (form.get("enable") === "1") enabled.add(key);
  else enabled.delete(key);

  await scope.writes.setEnabledSkills(projectId, [...enabled]);

  revalidatePath(`/progetti/${slug}/scrum-master`);
}

/**
 * The demonstration answer for the deterministic provider.
 *
 * Without it a stub that always replies in prose would fail the schema every
 * time, and the capability would be invisible to anyone without a vendor key.
 * It quotes only figures the snapshot supplies, so it passes the same fidelity
 * check a real model's answer has to pass — a canned answer that cheated would
 * be a demonstration of nothing.
 */
const DEMO_ANSWER = JSON.stringify({
  summary:
    "Lo sprint si è concluso e il lavoro portato a termine è quello riportato qui accanto. " +
    "Il resoconto si limita a ciò che le misure dicono, senza aggiungere valutazioni sulle persone.",
  flow:
    "Il percorso degli elementi, dalla presa in carico alla chiusura, è descritto dalle durate " +
    "riportate accanto a questo testo. Dove una misura non è calcolabile, viene dichiarata come tale.",
  attentionPoints: [],
});

export async function runSprintReportAction(form: FormData): Promise<void> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  const sprintId = form.get("sprintId");
  if (typeof slug !== "string" || typeof sprintId !== "string") redirect("/progetti");

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) redirect("/progetti");

  const projectId = projectIdSchema.parse(project.id);
  const loaded = await loadAgent(organizationId, projectId);
  if (!loaded) redirect(`/progetti/${slug}`);

  const runs = await scope.reads.skillRunsByProject(projectId);
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const runsToday = runs.filter(
    (run) =>
      run.scrumAgentId === loaded.agent.id && run.startedAt.getTime() >= startOfDay.getTime(),
  ).length;

  await runSprintReport({
    organizationId,
    projectId,
    sprintId: sprintIdSchema.parse(sprintId),
    agent: loaded.agent,
    options: { runsToday, stubResponse: DEMO_ANSWER },
  });

  revalidatePath(`/progetti/${slug}/scrum-master`);
}
