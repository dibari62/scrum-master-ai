"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  agentPersonaSchema,
  agentToneSchema,
  estimationScaleSchema,
  ESTIMATION_SCALE_LABELS,
  selectableAutonomyLevelSchema,
  type AgentPersona,
  type AgentTone,
  type SelectableAutonomyLevel,
} from "@/domain";

import { createAgentAction, type WizardState } from "../actions";
import { AUTONOMY, inline, PERSONA } from "../labels";

/**
 * The creation form.
 *
 * A client component, and one of the few in the application: it needs the
 * pending state of its own submission, which a server component cannot hold.
 *
 * **Everything arrives filled in.** The demonstrable goal of T3 is creating a
 * Scrum Master AI in two minutes; a form of empty required fields would turn
 * that into a typing exercise. The proposed values are read from the domain
 * schemas, so the form and the defaults cannot drift apart.
 *
 * **The wording comes from `../labels`, and that is a repair.** This form used
 * to define its own explanations — «Osserva — raccoglie e mostra, non scrive
 * nulla» — while the card the reader lives with afterwards showed the same
 * value stripped bare. The explanation existed and was thrown away exactly
 * where it was needed. Sharing the source makes that drift impossible rather
 * than unlikely.
 */

const PERSONA_LABELS: Readonly<Record<AgentPersona, string>> = Object.fromEntries(
  agentPersonaSchema.options.map((persona) => [persona, inline(PERSONA[persona])]),
) as Record<AgentPersona, string>;

const TONE_LABELS: Readonly<Record<AgentTone, string>> = {
  neutral: "Neutro",
  concise: "Conciso",
  supportive: "Incoraggiante",
  formal: "Formale",
};

const AUTONOMY_LABELS: Readonly<Record<SelectableAutonomyLevel, string>> =
  Object.fromEntries(
    selectableAutonomyLevelSchema.options.map((level) => [level, inline(AUTONOMY[level])]),
  ) as Record<SelectableAutonomyLevel, string>;

const SELECT_CLASS = "border-input bg-background h-9 rounded-md border px-3 text-sm";

type WizardProps = {
  readonly slug: string;
  readonly proposedName: string;
  readonly proposedSprintLength: number;
  /** Where the proposal comes from, so nobody mistakes it for a measurement. */
  readonly sprintLengthSource: "osservata" | "predefinita";
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creazione in corso…" : "Crea lo Scrum Master AI"}
    </Button>
  );
}

export function CreateAgentWizard({
  slug,
  proposedName,
  proposedSprintLength,
  sprintLengthSource,
}: WizardProps) {
  const [state, action] = useActionState<WizardState, FormData>(createAgentAction, {
    status: "idle",
  });

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="slug" value={slug} />

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">1 · Identità</legend>

        <div className="grid gap-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" defaultValue={proposedName} required maxLength={120} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="persona">Persona</Label>
          <select id="persona" name="persona" defaultValue="facilitator" className={SELECT_CLASS}>
            {agentPersonaSchema.options.map((persona) => (
              <option key={persona} value={persona}>
                {PERSONA_LABELS[persona]}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Influenza il registro con cui comunica, mai i fatti che riporta.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="tone">Tono</Label>
          <select id="tone" name="tone" defaultValue="neutral" className={SELECT_CLASS}>
            {agentToneSchema.options.map((tone) => (
              <option key={tone} value={tone}>
                {TONE_LABELS[tone]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="language">Lingua</Label>
          <select id="language" name="language" defaultValue="it" className={SELECT_CLASS}>
            <option value="it">Italiano</option>
            <option value="en">Inglese</option>
          </select>
          <p className="text-muted-foreground text-xs">
            È la lingua dei suoi output, non quella dell&apos;applicazione.
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">2 · Contesto di progetto</legend>

        <div className="grid gap-1.5">
          <Label htmlFor="sprintLengthDays">Durata dello sprint, in giorni</Label>
          <Input
            id="sprintLengthDays"
            name="sprintLengthDays"
            type="number"
            min={1}
            max={60}
            defaultValue={proposedSprintLength}
          />
          <p className="text-muted-foreground text-xs">
            {sprintLengthSource === "osservata"
              ? "Proposta a partire dagli sprint già registrati: calcolata in codice, e modificabile."
              : "Valore predefinito: non ci sono ancora sprint da cui dedurla."}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="estimationScale">Scala di stima</Label>
          <select
            id="estimationScale"
            name="estimationScale"
            defaultValue="free"
            className={SELECT_CLASS}
          >
            {estimationScaleSchema.options.map((scale) => (
              <option key={scale} value={scale}>
                {ESTIMATION_SCALE_LABELS[scale]}
              </option>
            ))}
          </select>
          {/*
           * Predefinita «nessuna».
           *
           * Dichiarare una scala al posto della squadra riempirebbe la pagina
           * degli elementi di segnalazioni su una regola che nessuno ha
           * adottato — e la prima reazione a un avviso ingiusto è imparare a
           * ignorare gli avvisi.
           */}
          <p className="text-muted-foreground text-xs">
            Con una scala dichiarata, il portale <strong>segnala</strong> le stime che non le
            appartengono. Non le corregge e non le rifiuta: arrivano da una fonte esterna.
          </p>
        </div>

        <p className="text-muted-foreground text-xs">
          Definition of Done, patto di squadra e stakeholder si aggiungono dalla scheda,
          dopo la creazione.
        </p>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">3 · Capacità e autonomia</legend>

        <div className="grid gap-1.5">
          <Label htmlFor="autonomyLevel">Livello di autonomia</Label>
          <select
            id="autonomyLevel"
            name="autonomyLevel"
            defaultValue="observe"
            className={SELECT_CLASS}
          >
            {selectableAutonomyLevelSchema.options.map((level) => (
              <option key={level} value={level}>
                {AUTONOMY_LABELS[level]}
              </option>
            ))}
          </select>
          {/*
           * I livelli superiori non compaiono affatto.
           *
           * Mostrarli disabilitati suggerirebbe che basti un permesso per
           * ottenerli, mentre sono fuori dal perimetro dell'intero PoC.
           */}
          <p className="text-muted-foreground text-xs">
            I livelli che agiscono sui sistemi esterni sono fuori dal perimetro di questo
            proof-of-concept.
          </p>
        </div>

        <p className="text-muted-foreground text-xs">
          Le skill che producono report arrivano con il traguardo successivo: alla creazione
          nessuna è abilitata.
        </p>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">4 · Conferma</legend>
        <p className="text-muted-foreground text-sm">
          Puoi confermare così com&apos;è: ogni valore ha già una proposta sensata, e tutto
          resta modificabile dalla scheda.
        </p>
      </fieldset>

      {state.status === "error" ? (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
