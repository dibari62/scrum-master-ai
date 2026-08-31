import { createProjectInputSchema, type CreateProjectInput } from "@/domain";
import {
  fieldErrorState,
  readFields,
  summaryErrorState,
  toFieldErrors,
  type FormState,
} from "@/app/form-state";
import type { CreateProjectFailureReason } from "@/lib/projects/create";

/**
 * The part of the creation form that is worth testing.
 *
 * Same split as the registration form: the action is a wrapper that cannot be
 * loaded outside a request, so reading the fields, validating them and deciding
 * which field a failure belongs to all happen here, in plain functions.
 */

export const CREATE_PROJECT_FIELDS = ["name", "slug", "description"] as const;

export type CreateProjectValues = Record<(typeof CREATE_PROJECT_FIELDS)[number], string>;

/**
 * Slugs the router has already spoken for.
 *
 * `/progetti/crea` is a fixed segment and wins over `/progetti/[slug]`, so a
 * project called `crea` would sit in the list and open the creation form when
 * clicked. Refusing it here costs one line; discovering it afterwards costs a
 * project nobody can open.
 */
export const RESERVED_PROJECT_SLUGS: readonly string[] = ["crea"];

const RESERVED_MESSAGE =
  "Questo identificativo è riservato all'applicazione. Scegline un altro.";

/** Copy for a failure the write reported, attached to the field at fault. */
const FAILURE_MESSAGES: Readonly<Record<CreateProjectFailureReason, string>> = {
  "slug-taken":
    "Questo identificativo è già usato da un altro progetto della tua azienda. Scegline un altro.",
  forbidden:
    "Serve un ruolo di amministratore per creare un progetto. Chiedi a un amministratore della tua azienda.",
};

export type ParsedCreateProject =
  | {
      readonly ok: true;
      readonly data: CreateProjectInput;
      /** Kept to redraw the form if the write then fails. */
      readonly values: CreateProjectValues;
    }
  | { readonly ok: false; readonly state: FormState<CreateProjectValues> };

/**
 * Reads and validates the submitted project.
 *
 * An empty description becomes `null` rather than `""`: the domain spells "no
 * description" as `null`, and two ways of writing the same absence is one more
 * case every reader downstream has to handle.
 */
export function parseCreateProjectForm(form: FormData): ParsedCreateProject {
  const values = readFields(form, CREATE_PROJECT_FIELDS);
  const description = values.description.trim();

  const parsed = createProjectInputSchema.safeParse({
    name: values.name,
    slug: values.slug,
    description: description === "" ? null : description,
  });

  if (!parsed.success) {
    return {
      ok: false,
      state: {
        status: "invalid",
        errors: { fields: toFieldErrors(parsed.error), summary: null },
        values,
      },
    };
  }

  // Checked after the schema so the comparison runs on the normalised slug:
  // "Crea" and " crea " reach the router as the same address.
  if (RESERVED_PROJECT_SLUGS.includes(parsed.data.slug)) {
    return { ok: false, state: fieldErrorState("slug", RESERVED_MESSAGE, values) };
  }

  return { ok: true, data: parsed.data, values };
}

/**
 * Turns a refused write into something the form can show.
 *
 * A taken slug belongs on the slug field, not at the top: «identificativo già
 * in uso» above a form of three inputs leaves the reader looking for which one
 * it means. A missing permission belongs to no field, so it goes in the
 * summary.
 */
export function creationFailureState(
  reason: CreateProjectFailureReason,
  values: CreateProjectValues,
): FormState<CreateProjectValues> {
  const message = FAILURE_MESSAGES[reason];

  return reason === "slug-taken"
    ? fieldErrorState("slug", message, values)
    : summaryErrorState(message, values);
}
