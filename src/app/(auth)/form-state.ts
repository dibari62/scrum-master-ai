import { z } from "zod";

import { signInInputSchema, signUpInputSchema } from "@/domain";
import {
  fieldErrorState,
  readFields,
  summaryErrorState,
  toFieldErrors,
  type FormErrors,
  type FormState,
  type ParseResult,
} from "@/app/form-state";
import type { RegistrationFailureReason } from "@/lib/auth/registration";

/**
 * The part of the sign-up and sign-in forms that is worth testing.
 *
 * A server action pulls in `next/headers` and Auth.js, so it cannot be loaded
 * outside a request. Everything here is a plain function over plain data:
 * reading the submitted fields, turning validation failures into per-field
 * copy, and naming what went wrong. The actions stay thin wrappers around it.
 *
 * The generic half — the shapes and the three helpers — moved to
 * `@/app/form-state` the day a second form needed it. Re-exported here so the
 * callers that already know this module keep working.
 */

export type { FormErrors, FormState, ParseResult };
export { readFields };

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

  return fieldErrorState(field, message, withoutPassword(values));
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
  return summaryErrorState(SIGN_IN_FAILURE_MESSAGE, withoutPassword(values));
}
