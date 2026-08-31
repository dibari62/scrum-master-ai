"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/projects/create";

import type { FormState } from "@/app/form-state";

import {
  creationFailureState,
  parseCreateProjectForm,
  type CreateProjectValues,
} from "./form-state";

/**
 * Server action for project creation.
 *
 * A *server action* is a function that the browser can call by submitting a
 * form, but whose body only ever runs on the server — the closest AS/400
 * analogy is a program invoked by a screen, except that the parameter list is
 * the form itself and therefore entirely under the caller's control. That is
 * why nothing here trusts the body: the organization comes from the session and
 * the permission is checked again below the interface (§8.4).
 *
 * Thin on purpose: the decisions live in `./form-state` and
 * `@/lib/projects/create`, which are plain functions and can be tested. This
 * one cannot be — its identifier is generated at build time, so only a browser
 * that loaded the page can invoke it, which is what the end-to-end suite does.
 */
export async function createProjectAction(
  _previous: FormState<CreateProjectValues>,
  form: FormData,
): Promise<FormState<CreateProjectValues>> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const parsed = parseCreateProjectForm(form);
  if (!parsed.ok) return parsed.state;

  const outcome = await createProject({
    organizationId: organizationIdSchema.parse(session.organizationId),
    role: session.role,
    payload: parsed.data,
  });

  if (!outcome.ok) return creationFailureState(outcome.reason, parsed.values);

  /*
   * L'elenco viene rigenerato anche se non ci si torna.
   *
   * `revalidatePath` dice a Next che la versione già calcolata di quella pagina
   * non vale più. Senza, chi torna all'elenco dal menù troverebbe un elenco che
   * non contiene il progetto appena creato — e un progetto che non compare si
   * legge come un comando che non ha funzionato.
   */
  revalidatePath("/progetti");

  /*
   * Si va sulla dashboard del progetto nuovo, non sull'elenco.
   *
   * **Questa decisione era l'opposto fino a poco fa**, e la ragione era buona:
   * la dashboard di un progetto vuoto mostrava nove metriche a trattino, il che
   * è corretto e indistinguibile da un guasto per chi la vede come prima
   * schermata.
   *
   * Quella dashboard adesso apre con i **primi passi** — cosa manca, a che cosa
   * serve, e il collegamento per farlo — quindi la causa non c'è più. E
   * atterrare nel progetto appena creato è ciò che chi ha premuto «Crea» si
   * aspetta: l'elenco gli mostrava una riga in più e lo lasciava a chiedersi
   * cosa fare adesso.
   */
  redirect(`/progetti/${parsed.data.slug}`);
}
