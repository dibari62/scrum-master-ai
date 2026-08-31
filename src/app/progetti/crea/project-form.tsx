"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { FormField } from "@/app/(auth)/form-field";
import type { FormState } from "@/app/form-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { slugify } from "@/domain";

import { createProjectAction } from "./actions";
import type { CreateProjectValues } from "./form-state";

/**
 * The project creation form.
 *
 * A client component, and one of the few in the application: it holds the
 * pending state of its own submission and the link between the name and the
 * identifier, neither of which a Server Component can keep.
 */

const INITIAL: FormState<CreateProjectValues> = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 " +
  "min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none " +
  "transition-[color,box-shadow] focus-visible:ring-[3px] md:text-sm";

function errorFor(state: FormState<CreateProjectValues>, field: string): string | undefined {
  return state.status === "invalid" ? state.errors.fields[field] : undefined;
}

function valueFor(
  state: FormState<CreateProjectValues>,
  field: keyof CreateProjectValues,
): string {
  return state.status === "invalid" ? state.values[field] : "";
}

export function CreateProjectForm() {
  const [state, action, pending] = useActionState(createProjectAction, INITIAL);

  /**
   * The identifier follows the project name until someone edits it by hand, and
   * then stops. Exactly the behaviour of the company form in `/registrati`, and
   * deliberately the same implementation: silently overwriting a deliberate
   * choice on the next keystroke is the kind of helpfulness people fight with.
   */
  const [slug, setSlug] = useState(() => valueFor(state, "slug"));
  const [slugEdited, setSlugEdited] = useState(false);

  const summary = state.status === "invalid" ? state.errors.summary : null;
  const descriptionError = errorFor(state, "description");

  return (
    <form action={action} className="grid gap-5">
      {summary ? (
        // `role="alert"` so the message is announced when it appears, rather
        // than being a paragraph that quietly showed up above the fold.
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {summary}
        </p>
      ) : null}

      <FormField
        name="name"
        label="Nome del progetto"
        required
        maxLength={120}
        autoComplete="off"
        placeholder="Piattaforma di checkout"
        defaultValue={valueFor(state, "name")}
        error={errorFor(state, "name")}
        onChange={(event) => {
          if (!slugEdited) setSlug(slugify(event.target.value));
        }}
      />

      <FormField
        name="slug"
        label="Identificativo"
        hint="Comparirà nell'indirizzo della pagina. Solo lettere minuscole, cifre e trattini singoli."
        required
        maxLength={48}
        autoComplete="off"
        inputMode="url"
        value={slug}
        error={errorFor(state, "slug")}
        onChange={(event) => {
          setSlugEdited(true);
          setSlug(event.target.value);
        }}
      />

      {/*
       * L'indirizzo che verrà, mostrato mentre si scrive.
       *
       * «Comparirà negli indirizzi» è una frase; questa riga è la cosa stessa,
       * e chiarisce in un colpo perché l'identificativo non ammette spazi né
       * maiuscole. `break-all` perché su schermo stretto un identificativo
       * lungo sborderebbe invece di andare a capo.
       */}
      <p className="text-muted-foreground -mt-3 text-xs break-all">
        Indirizzo del progetto:{" "}
        <code className="font-mono">/progetti/{slug === "" ? "…" : slug}</code>
      </p>

      <div className="grid gap-2">
        <Label htmlFor="description">Descrizione (facoltativa)</Label>
        <textarea
          id="description"
          name="description"
          maxLength={2000}
          rows={3}
          className={TEXTAREA_CLASS}
          placeholder="A cosa serve questo progetto, in una riga."
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={descriptionError ? "description-errore" : "description-nota"}
          defaultValue={valueFor(state, "description")}
        />
        <p id="description-nota" className="text-muted-foreground text-sm">
          Compare nell&apos;elenco dei progetti. Si può aggiungere anche dopo.
        </p>
        {descriptionError ? (
          <p id="description-errore" className="text-destructive text-sm">
            {descriptionError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creazione in corso…" : "Crea il progetto"}
        </Button>

        {/*
         * Nessun `disabled` sull'annulla: è un collegamento, e `disabled` su un
         * ancora non è un attributo valido — React lo segnalerebbe in console e
         * chi sta annullando resterebbe senza via d'uscita durante l'attesa.
         */}
        <Button asChild variant="outline">
          <Link href="/progetti">Annulla</Link>
        </Button>
      </div>
    </form>
  );
}
