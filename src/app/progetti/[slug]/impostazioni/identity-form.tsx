"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Project } from "@/domain";

import { saveIdentityAction, type SettingsFormState } from "./actions";

/**
 * L'anagrafica del progetto: come si chiama, a cosa serve, se è ancora vivo.
 *
 * **Perché mancava.** Un progetto si creava e poi era immutabile: correggere un
 * refuso nel nome o archiviarne uno concluso richiedeva una `UPDATE` scritta a
 * mano sul database. I campi erano già tutti nel modello, e nessuno li poteva
 * toccare.
 *
 * Modulo separato da quello tecnico, di proposito: chi corregge un refuso non
 * deve rimandare anche la configurazione di Jira: è la strada per cambiare
 * qualcosa senza volerlo.
 */

const INITIAL: SettingsFormState = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 " +
  "min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none " +
  "transition-[color,box-shadow] focus-visible:ring-[3px]";

export function IdentityForm({ project }: { readonly project: Project }) {
  const [state, action, pending] = useActionState(saveIdentityAction, INITIAL);
  const [archived, setArchived] = useState(project.status === "archived");

  const error = (name: string) =>
    state.status === "error" ? state.fields[name] : undefined;

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="slug" value={project.slug} />

      {state.status === "error" ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="name">Nome del progetto</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={project.name}
          aria-invalid={error("name") ? true : undefined}
        />
        <p className="text-muted-foreground text-sm">
          Compare nell&apos;elenco dei progetti e in cima a ogni schermata.
        </p>
        {error("name") ? <p className="text-destructive text-sm">{error("name")}</p> : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Descrizione</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          className={TEXTAREA_CLASS}
          placeholder="A cosa serve questo progetto, in una riga o due."
          defaultValue={project.description ?? ""}
          aria-invalid={error("description") ? true : undefined}
        />
        <p className="text-muted-foreground text-sm">
          Serve a chi apre l&apos;elenco dei progetti e non sa quale sia il suo. Su
          un&apos;azienda con dieci progetti è la differenza fra un elenco e un indovinello.
        </p>
        {error("description") ? (
          <p className="text-destructive text-sm">{error("description")}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="identificativo">Identificativo</Label>
        {/*
         * Mostrato e non modificabile, ed è una scelta.
         *
         * Cambiarlo cambia l'indirizzo di ogni pagina del progetto: ogni
         * collegamento salvato da qualcuno smetterebbe di funzionare, in
         * silenzio e senza modo di accorgersene. Vale la pena poterlo fare, ma
         * non da un campo che sembra uno come gli altri.
         */}
        <Input id="identificativo" value={project.slug} readOnly disabled />
        <p className="text-muted-foreground text-sm">
          Non si cambia: comparendo negli indirizzi, modificarlo romperebbe ogni
          collegamento che qualcuno ha salvato.
        </p>
      </div>

      <div className="grid gap-2 border-t pt-5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="status"
            value="archived"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Archivia questo progetto
        </label>
        {/*
         * Archiviato, mai cancellato.
         *
         * Sprint, elementi e metriche già calcolate restano validi, e una
         * cancellazione riscriverebbe in silenzio la serie storica su cui poggia
         * tutto il prodotto.
         */}
        <p className="text-muted-foreground text-sm">
          Un progetto archiviato esce dall&apos;uso quotidiano ma <strong>non si
          cancella</strong>: sprint, elementi e metriche già calcolate restano leggibili.
          Cancellarlo riscriverebbe la serie storica su cui poggia ogni confronto fra
          sprint.
        </p>
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva l'anagrafica"}
        </Button>
      </div>
    </form>
  );
}
