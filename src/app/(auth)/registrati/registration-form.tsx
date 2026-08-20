"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { slugify } from "@/domain";

import { registerAction } from "../actions";
import { FormField } from "../form-field";
import type { FormState, SignUpValues } from "../form-state";

const INITIAL: FormState<SignUpValues> = { status: "idle" };

function errorFor(state: FormState<SignUpValues>, field: string): string | undefined {
  return state.status === "invalid" ? state.errors.fields[field] : undefined;
}

function valueFor(state: FormState<SignUpValues>, field: keyof SignUpValues): string {
  return state.status === "invalid" ? state.values[field] : "";
}

export function RegistrationForm() {
  const [state, action, pending] = useActionState(registerAction, INITIAL);

  /**
   * The slug follows the company name until someone edits it by hand, and then
   * stops: silently overwriting a deliberate choice on the next keystroke is
   * the kind of helpfulness people fight with.
   */
  const [slug, setSlug] = useState(() => valueFor(state, "organizationSlug"));
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="grid gap-5">
      <FormField
        name="organizationName"
        label="Nome dell'azienda"
        autoComplete="organization"
        required
        defaultValue={valueFor(state, "organizationName")}
        error={errorFor(state, "organizationName")}
        onChange={(event) => {
          if (!slugEdited) setSlug(slugify(event.target.value));
        }}
      />

      <FormField
        name="organizationSlug"
        label="Identificativo"
        hint="Comparirà negli indirizzi delle pagine. Solo lettere minuscole, cifre e trattini."
        required
        value={slug}
        error={errorFor(state, "organizationSlug")}
        onChange={(event) => {
          setSlugEdited(true);
          setSlug(event.target.value);
        }}
      />

      <FormField
        name="name"
        label="Il tuo nome"
        autoComplete="name"
        required
        defaultValue={valueFor(state, "name")}
        error={errorFor(state, "name")}
      />

      <FormField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={valueFor(state, "email")}
        error={errorFor(state, "email")}
      />

      <FormField
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="Almeno 12 caratteri. Una frase è più sicura e più facile da ricordare."
        error={errorFor(state, "password")}
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Creazione in corso…" : "Crea l'account"}
      </Button>
    </form>
  );
}
