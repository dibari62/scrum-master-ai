"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { askProjectAction, type QuestionState } from "./question-actions";

/**
 * A free question about the project, answered with its sources.
 *
 * **Why the sources are shown and not just counted.** Every other answer in this
 * product sits beside the figures it describes, so a reader checks it by looking
 * up. This one has nothing beside it: the links to the items it was built from
 * are what turn it back into something verifiable rather than something to
 * believe.
 */

const INITIAL: QuestionState = { status: "idle" };

export function ProjectQuestion({
  slug,
  enabled,
}: {
  readonly slug: string;
  readonly enabled: boolean;
}) {
  const [state, action, pending] = useActionState(askProjectAction, INITIAL);

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fai una domanda sul progetto</CardTitle>
          <CardDescription>
            Lo Scrum Master AI può rispondere a domande in parole tue citando gli elementi su
            cui si basa. La capacità «Domande sul progetto» non è accesa su questo progetto.
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
        <CardTitle className="text-base">Fai una domanda sul progetto</CardTitle>
        <CardDescription>
          La risposta si basa solo sugli elementi di questo progetto, e cita quali ha usato:
          se non trova nulla di pertinente lo dice, invece di inventare. Non calcola numeri —
          per quelli ci sono le schermate delle metriche.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <form action={action} className="grid gap-2">
          <input type="hidden" name="slug" value={slug} />

          <label htmlFor="question" className="text-muted-foreground text-xs">
            La tua domanda
          </label>

          <div className="flex flex-wrap items-start gap-2">
            <input
              id="question"
              name="question"
              type="text"
              maxLength={500}
              required
              placeholder="Per esempio: cosa c'è sulla spedizione?"
              className="border-input bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sto cercando…" : "Chiedi"}
            </Button>
          </div>
        </form>

        {state.status === "refused" ? (
          <p className="text-destructive text-sm">{state.message}</p>
        ) : null}

        {state.status === "ok" ? (
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Domanda: <span className="text-foreground">{state.question}</span>
            </p>

            <p>{state.answer.answer}</p>

            {state.sources.length > 0 ? (
              <div className="grid gap-1">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  Su quali elementi si basa
                </h3>
                <ul className="grid gap-1">
                  {state.sources.map((source) => (
                    <li key={source.workItemId}>
                      <a
                        href={`/progetti/${slug}/elementi/${source.workItemId}`}
                        className="underline underline-offset-4"
                      >
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-muted-foreground text-xs">
              {state.answer.unknown
                ? "Nessuna risposta è stata composta: quando le fonti non bastano, dirlo è più utile che riempire il silenzio."
                : "Risposta costruita solo sugli elementi elencati qui sopra. Non viene conservata."}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
