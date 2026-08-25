"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATE_LABELS } from "@/lib/state-words";

import { narrateFlowAction, type FlowNarrationState } from "./flow-actions";

/**
 * The explanation of the flow, asked for rather than generated on arrival.
 *
 * It sits under the table it explains, for the same reason the health narration
 * sits under its traffic light: a paragraph commenting on figures the reader
 * cannot see beside it is a paragraph that has to be taken on trust.
 */

const INITIAL: FlowNarrationState = { status: "idle" };

export function FlowNarration({
  slug,
  enabled,
}: {
  readonly slug: string;
  readonly enabled: boolean;
}) {
  const [state, action, pending] = useActionState(narrateFlowAction, INITIAL);

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lettura del flusso</CardTitle>
          <CardDescription>
            Lo Scrum Master AI può riassumere a parole dove il lavoro si ferma e quanto poco
            del tempo totale sia lavorazione vera. La capacità «Collo di bottiglia» non è
            accesa su questo progetto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <a href={`/progetti/${slug}/scrum-master`}>Vai alle capacità dell&apos;agente</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lettura del flusso</CardTitle>
        <CardDescription>
          I numeri qui sopra sono calcolati dal codice. Questa lettura li mette in fila e non
          può indicare una fase diversa da quella misurata: se lo facesse verrebbe rifiutata
          invece che mostrata.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Sto leggendo le fasi…" : "Spiegami dove si ferma il lavoro"}
          </Button>
        </form>

        {state.status === "refused" ? (
          <p className="text-destructive text-sm">{state.message}</p>
        ) : null}

        {state.status === "ok" ? (
          <div className="grid gap-3 text-sm">
            <p>{state.narrative.situation}</p>

            {state.narrative.observations.length > 0 ? (
              <dl className="grid gap-2">
                {state.narrative.observations.map((observation) => (
                  <div key={observation.state} className="grid gap-0.5">
                    <dt className="font-medium">{STATE_LABELS[observation.state]}</dt>
                    <dd className="text-muted-foreground">{observation.observation}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <p className="text-muted-foreground text-xs">
              {state.origin === "model"
                ? "Testo generato da un modello linguistico a partire dalle durate calcolate dal codice. Non viene conservato: descrive il flusso di adesso."
                : "Testo scritto dal codice, non da un modello linguistico: su questo ambiente non è configurato alcun fornitore. Riporta quale fase trattiene più a lungo il lavoro, senza aggiungere una lettura. Non viene conservato: descrive il flusso di adesso."}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
