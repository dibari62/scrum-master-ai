"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptanceThresholdCutoffsSchema,
  organizationIdSchema,
  projectIdSchema,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { mayConfigureAgent } from "@/lib/agents/scrum-agent";

/**
 * Server actions for the product backlog.
 *
 * They live beside the page that uses them rather than under `scrum-master/`,
 * where the first draft put them: the thresholds are a statement about the
 * *backlog*, and an action filed under the agent would suggest the agent
 * decides them. It does not — a person does.
 */

/**
 * Declares where the acceptance thresholds cut the backlog.
 *
 * Three counts, read from the form and validated: a threshold is a statement
 * about a contract, and a value that reached the database unchecked would be a
 * commitment nobody made.
 *
 * An empty form clears them. That is deliberately available, because "we are no
 * longer committing to a 1.0 scope" has to be sayable — and it is not the same
 * as setting every band to zero, which says the opposite.
 *
 * No `redirect` on success. The form is already on the page it would redirect
 * to, so the redirect would be a navigation to where the reader already is —
 * noise in the log and nothing on screen. `revalidatePath` is what makes the
 * new values appear.
 */
export async function setAcceptanceThresholdsAction(form: FormData): Promise<void> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") redirect("/progetti");

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) redirect("/progetti");

  // Il controllo sta qui oltre che nell'interfaccia: un modulo nascosto non è
  // un'autorizzazione.
  if (!mayConfigureAgent(session.role)) redirect(`/progetti/${slug}/backlog`);

  /*
   * «Nessuna soglia» si dichiara svuotando i tre campi, non con un pulsante a
   * parte: un comando in più per un caso raro è un comando in più da capire.
   */
  const raw = ["must", "should", "later"].map((band) => form.get(band));
  const cleared = raw.every((value) => typeof value !== "string" || value.trim() === "");

  const projectId = projectIdSchema.parse(project.id);

  if (cleared) {
    await scope.writes.setAcceptanceThresholds(projectId, null);
    revalidateBacklog(slug);
    return;
  }

  const parsed = acceptanceThresholdCutoffsSchema.safeParse({
    must: Number(raw[0] ?? 0),
    should: Number(raw[1] ?? 0),
    later: Number(raw[2] ?? 0),
  });

  // Un valore rifiutato non scrive nulla: meglio nessuna soglia che una soglia
  // che il dominio non riconosce.
  if (!parsed.success) return;

  await scope.writes.setAcceptanceThresholds(projectId, parsed.data);
  revalidateBacklog(slug);
}

/**
 * Invalidates the **project** layout, not just the backlog page.
 *
 * The form posts from the backlog page and stays there, so what has to be
 * rebuilt is the tree that contains it. `setSkillEnabledAction` invalidates the
 * project layout for the same reason, and its end-to-end tests are what prove
 * the shape works.
 *
 * **A warning to whoever debugs this next.** While building it, the page seemed
 * not to update: the database held the new thresholds and the screen showed the
 * old ones. It was not the application — it was the probe. A server action does
 * **not navigate**, so `waitForLoadState("networkidle")` returns before the
 * re-render arrives, and a script that reads the page at that moment reads the
 * previous one. Waiting for the *element* instead showed it updating on its own,
 * with no reload. An hour went into that, and two plausible fixes were applied
 * to a fault that was never there.
 */
function revalidateBacklog(slug: string): void {
  revalidatePath(`/progetti/${slug}`, "layout");
}
