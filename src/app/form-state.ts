import type { z } from "zod";

/**
 * Form primitives shared by every form in the application.
 *
 * These used to live inside `(auth)/form-state.ts`, where they were written for
 * registration and sign-in. The project form needs exactly the same three
 * things — read the submitted fields, turn Zod issues into per-field copy, put
 * a message on the field at fault — and a second copy of them would be a second
 * place where "which field is wrong" can be decided differently.
 *
 * Everything here is a plain function over plain data, so it is testable without
 * a request: a server action pulls in `next/headers` and cannot be loaded
 * outside one.
 */

/** Per-field messages, plus one for failures that belong to no single field. */
export type FormErrors = {
  readonly fields: Readonly<Record<string, string>>;
  readonly summary: string | null;
};

export type FormState<Values> =
  | { readonly status: "idle" }
  | {
      readonly status: "invalid";
      readonly errors: FormErrors;
      readonly values: Values;
    };

export type ParseResult<Data, Values> =
  | { readonly ok: true; readonly data: Data }
  | { readonly ok: false; readonly state: FormState<Values> };

/**
 * Keeps the first message per field.
 *
 * Zod reports every failed rule; stacking four lines under one field is noise,
 * and the first one has to be fixed anyway.
 */
export function toFieldErrors(error: z.ZodError): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path !== "string") continue;
    if (path in fields) continue;

    fields[path] = issue.message;
  }

  return fields;
}

/**
 * Reads `names` out of a `FormData` as plain strings.
 *
 * A missing field and a field submitted as a file both become `""`, so the Zod
 * schema decides what is acceptable instead of each caller guessing.
 */
export function readFields<Name extends string>(
  form: FormData,
  names: readonly Name[],
): Record<Name, string> {
  const values = {} as Record<Name, string>;

  for (const name of names) {
    const value = form.get(name);
    values[name] = typeof value === "string" ? value : "";
  }

  return values;
}

/**
 * A failure attached to one field, with the form redrawn as it was submitted.
 *
 * Attaching the message to the field rather than to the top of the form is what
 * makes it actionable: "questo identificativo è già in uso" above a form of
 * five inputs leaves the reader looking for which one it means.
 */
export function fieldErrorState<Values>(
  field: string,
  message: string,
  values: Values,
): FormState<Values> {
  return {
    status: "invalid",
    errors: { fields: { [field]: message }, summary: null },
    values,
  };
}

/** A failure that belongs to no field: shown once, above the form. */
export function summaryErrorState<Values>(
  message: string,
  values: Values,
): FormState<Values> {
  return {
    status: "invalid",
    errors: { fields: {}, summary: message },
    values,
  };
}
