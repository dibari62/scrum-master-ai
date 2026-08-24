"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SIGNAL_TITLES } from "@/lib/health-words";

import { narrateHealthAction, type NarrationState } from "./health-actions";

/**
 * The button that asks for an explanation, and the explanation itself.
 *
 * **Why nothing is generated when the page opens.** A page that spends money to
 * be looked at is a page nobody leaves open, and most visits to a dashboard are
 * a glance at the colour rather than a request for prose. So the reader asks.
 *
 * A client component because the answer is not stored anywhere: it exists only
 * as the result of this request, which is precisely what `useActionState` holds.
 */

const INITIAL: NarrationState = { status: "idle" };

export function HealthNarration({
  slug,
  enabled,
}: {
  readonly slug: string;
  /** Whether the capability is switched on for this project's agent. */
  readonly enabled: boolean;
}) {
  const [state, action, pending] = useActionState(narrateHealthAction, INITIAL);

  if (!enabled) {
    /*
     * Ciò che manca si dice, e si dice dove si accende (R6).
     *
     * Un riquadro assente lascerebbe credere che la funzione non esista; un
     * pulsante che rifiuta sempre sarebbe peggio ancora.
     */
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spiegazione del giudizio</CardTitle>
          <CardDescription>
            Lo Scrum Master AI può mettere in relazione i segnali qui sopra e dire come il
            giudizio si è mosso nei giorni scorsi. La capacità «Salute dello sprint» non è
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
        <CardTitle className="text-base">Spiegazione del giudizio</CardTitle>
        <CardDescription>
          Il verdetto qui sopra è calcolato dal codice. Questa spiegazione mette in relazione i
          segnali fra loro e non può citare numeri diversi da quelli misurati: se lo facesse,
          verrebbe rifiutata invece che mostrata.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Sto leggendo i segnali…" : "Chiedi una spiegazione"}
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
                  <div key={observation.signalId} className="grid gap-0.5">
                    <dt className="font-medium">{SIGNAL_TITLES[observation.signalId]}</dt>
                    <dd className="text-muted-foreground">{observation.observation}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {state.narrative.trend === undefined ? null : (
              <p className="text-muted-foreground">
                <span className="text-foreground font-medium">Andamento: </span>
                {state.narrative.trend}
              </p>
            )}

            <p className="text-muted-foreground text-xs">
              Testo generato da un modello linguistico a partire dai numeri calcolati dal
              codice. Non viene conservato: descrive lo stato di adesso.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
