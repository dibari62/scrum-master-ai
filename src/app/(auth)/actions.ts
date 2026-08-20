"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn, signOut } from "@/lib/auth";
import { registerOrganization } from "@/lib/auth/registration";

import {
  parseSignInForm,
  parseSignUpForm,
  registrationFailureState,
  signInFailureState,
  type FormState,
  type SignInValues,
  type SignUpValues,
} from "./form-state";
import { isRedirectError } from "./redirect-error";

/**
 * Server actions for registration and sign-in.
 *
 * Auth.js reports a successful `signIn` by throwing the redirect that Next.js
 * then performs, so every `catch` here lets that error through first — see
 * `./redirect-error`. The decision logic lives in `./form-state`, which is
 * plain functions and therefore testable; these wrappers stay thin.
 */

/** Where a successful sign-in lands. */
const AFTER_SIGN_IN = "/organizzazione";

const SIGN_IN_PAGE = "/accedi";

/**
 * Registers a company and its first user, then signs that user in.
 *
 * Signing in here spares retyping credentials entered thirty seconds ago; the
 * password is still in hand at this point and nowhere else.
 */
export async function registerAction(
  _previous: FormState<SignUpValues>,
  form: FormData,
): Promise<FormState<SignUpValues>> {
  const parsed = parseSignUpForm(form);
  if (!parsed.ok) return parsed.state;

  const outcome = await registerOrganization(parsed.data);

  if (!outcome.ok) {
    return registrationFailureState(outcome.reason, {
      organizationName: parsed.data.organizationName,
      organizationSlug: parsed.data.organizationSlug,
      name: parsed.data.name,
      email: parsed.data.email,
      password: "",
    });
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: AFTER_SIGN_IN,
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;

    // The account was created; only the automatic sign-in failed. Sending the
    // person to the sign-in form is a working outcome — a 500 on top of a
    // successful registration reads as "it did not work", and they try again.
    redirect(SIGN_IN_PAGE);
  }

  // Unreachable: one of the two branches above always throws. Present so the
  // return type stays total.
  return { status: "idle" };
}

export async function signInAction(
  _previous: FormState<SignInValues>,
  form: FormData,
): Promise<FormState<SignInValues>> {
  const parsed = parseSignInForm(form);
  if (!parsed.ok) return parsed.state;

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: AFTER_SIGN_IN,
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;

    // Only an authentication failure becomes a message. A database outage or a
    // misconfigured provider must not be reported as "wrong password": the
    // person would spend the afternoon retyping a correct one (§7).
    if (error instanceof AuthError) {
      return signInFailureState({ email: parsed.data.email, password: "" });
    }

    throw error;
  }

  return { status: "idle" };
}

export async function signInWithGitHubAction(): Promise<void> {
  await signIn("github", { redirectTo: AFTER_SIGN_IN });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
