"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { requestDigestAction, type DigestState } from "./digest-actions";

/**
 * The previous day, written up on request.
 *
 * **Why the heading says «ieri» and not «digest».** «Digest giornaliero» is the
 * name of a capability; «Cosa è successo ieri» is the question a reader has. The
 * card is named after the question, because that is what somebody scanning the
 * page is looking for.
 */

const INITIAL: DigestState = { status: "idle" };

export function DailyDigest({
  slug,
  enabled,
}: {
  readonly slug: string;
  readonly enabled: boolean;
}) {
  const [state, action, pending] = useActionState(requestDigestAction, INITIAL);

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cosa è successo ieri</CardTitle>
          <CardDescription>
            Lo Scrum Master AI può riassumere la giornata precedente: cosa è stato concluso,
            cosa è tornato indietro e — soprattutto — cosa non si è mosso. La capacità
            «Digest giornaliero» non è accesa su questo progetto.
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
        <CardTitle className="text-base">Cosa è successo ieri</CardTitle>
        <CardDescription>
          Conclusi, avviati, riaperti e fermi vengono contati dal codice sulle ventiquattro ore
          precedenti. Il riassunto non può tacere ciò che è fermo: se lo facesse verrebbe
          rifiutato invece che mostrato.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Sto contando la giornata…" : "Riassumi la giornata di ieri"}
          </Button>
        </form>

        {state.status === "refused" ? (
          <p className="text-destructive text-sm">{state.message}</p>
        ) : null}

        {state.status === "ok" ? (
          <div className="grid gap-3 text-sm">
            <p className="font-medium">{state.narrative.headline}</p>

            <div className="grid gap-1">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Cosa si è mosso
              </h3>
              <p>{state.narrative.movement}</p>
            </div>

            {state.narrative.standstill === undefined ? null : (
              <div className="grid gap-1">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Cosa è rimasto fermo
                </h3>
                <p>{state.narrative.standstill}</p>
              </div>
            )}

            <p className="text-muted-foreground text-xs">
              {state.origin === "model"
                ? "Testo generato da un modello linguistico a partire dai conteggi calcolati dal codice. Non viene conservato: descrive una giornata sola."
                : "Testo scritto dal codice, non da un modello linguistico: su questo ambiente non è configurato alcun fornitore. Riporta i conteggi senza aggiungere una lettura. Non viene conservato: descrive una giornata sola."}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
