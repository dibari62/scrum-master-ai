import { z } from "zod";

import { signInInputSchema, signUpInputSchema } from "@/domain";
import type { RegistrationFailureReason } from "@/lib/auth/registration";

/**
 * The part of the forms that is worth testing.
 *
 * A server action pulls in `next/headers` and Auth.js, so it cannot be loaded
 * outside a request. Everything here is a plain function over plain data:
 * reading the submitted fields, turning validation failures into per-field
 * copy, and naming what went wrong. The actions stay thin wrappers around it.
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

/**
 * Keeps the first message per field.
 *
 * Zod reports every failed rule; stacking four lines under one field is noise,
 * and the first one has to be fixed anyway.
 */
function toFieldErrors(error: z.ZodError): Readonly<Record<string, string>> {
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

export const SIGN_UP_FIELDS = [
  "organizationName",
  "organizationSlug",
  "name",
  "email",
  "password",
] as const;

export const SIGN_IN_FIELDS = ["email", "password"] as const;

export type SignUpValues = Record<(typeof SIGN_UP_FIELDS)[number], string>;
export type SignInValues = Record<(typeof SIGN_IN_FIELDS)[number], string>;

/**
 * Values sent back to redraw the form after a failure.
 *
 * The password is dropped on purpose: echoing it into the returned HTML puts
 * it somewhere it has no reason to be. The person retypes it.
 */
function withoutPassword<Values extends { password: string }>(values: Values): Values {
  return { ...values, password: "" };
}

export type ParseResult<Data, Values> =
  | { readonly ok: true; readonly data: Data }
  | { readonly ok: false; readonly state: FormState<Values> };

function invalid<Values extends { password: string }>(
  error: z.ZodError,
  values: Values,
): FormState<Values> {
  return {
    status: "invalid",
    errors: { fields: toFieldErrors(error), summary: null },
    values: withoutPassword(values),
  };
}

export function parseSignUpForm(
  form: FormData,
): ParseResult<z.infer<typeof signUpInputSchema>, SignUpValues> {
  const values = readFields(form, SIGN_UP_FIELDS);
  const parsed = signUpInputSchema.safeParse(values);

  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, state: invalid(parsed.error, values) };
}

export function parseSignInForm(
  form: FormData,
): ParseResult<z.infer<typeof signInInputSchema>, SignInValues> {
  const values = readFields(form, SIGN_IN_FIELDS);
  const parsed = signInInputSchema.safeParse(values);

  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, state: invalid(parsed.error, values) };
}

/** Copy for a collision the database reported, attached to the field at fault. */
const REGISTRATION_MESSAGES: Readonly<
  Record<RegistrationFailureReason, { readonly field: string; readonly message: string }>
> = {
  "organization-slug-taken": {
    field: "organizationSlug",
    message: "Questo identificativo è già utilizzato. Scegline un altro.",
  },
  "email-taken": {
    field: "email",
    message: "Esiste già un account con questo indirizzo.",
  },
};

export function registrationFailureState(
  reason: RegistrationFailureReason,
  values: SignUpValues,
): FormState<SignUpValues> {
  const { field, message } = REGISTRATION_MESSAGES[reason];

  return {
    status: "invalid",
    errors: { fields: { [field]: message }, summary: null },
    values: withoutPassword(values),
  };
}

/**
 * The only answer a failed sign-in ever gives.
 *
 * Distinguishing "no such address" from "wrong password" turns the form into a
 * way to discover which addresses are registered — the same reason `authorize`
 * returns `null` for every failure instead of explaining itself.
 */
export const SIGN_IN_FAILURE_MESSAGE = "Indirizzo email o password non corretti.";

export function signInFailureState(values: SignInValues): FormState<SignInValues> {
  return {
    status: "invalid",
    errors: { fields: {}, summary: SIGN_IN_FAILURE_MESSAGE },
    values: withoutPassword(values),
  };
}
