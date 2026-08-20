"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { signInAction } from "../actions";
import { FormField } from "../form-field";
import type { FormState, SignInValues } from "../form-state";

const INITIAL: FormState<SignInValues> = { status: "idle" };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL);

  const summary = state.status === "invalid" ? state.errors.summary : null;
  const email = state.status === "invalid" ? state.values.email : "";

  return (
    <form action={action} className="grid gap-5">
      {summary ? (
        // `role="alert"` so the message is announced when it appears: it is
        // the only feedback a failed sign-in gives.
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {summary}
        </p>
      ) : null}

      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={email}
        error={state.status === "invalid" ? state.errors.fields["email"] : undefined}
      />

      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={state.status === "invalid" ? state.errors.fields["password"] : undefined}
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Accesso in corso…" : "Accedi"}
      </Button>
    </form>
  );
}
