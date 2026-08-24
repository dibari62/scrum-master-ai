import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The two screens every data-backed view needs besides the data itself.
 *
 * Written once and shared because both are easy to leave out and impossible to
 * notice missing on a fast machine with a warm database: the loading state only
 * appears while the Neon instance wakes up from scale-to-zero, and the error
 * state only when something has already gone wrong. A view without them shows a
 * blank frame for two seconds and then, on a bad day, nothing at all.
 *
 * Presentational, like everything in `src/components`: they receive their words
 * and decide nothing (§4).
 */

type LoadingPageProps = {
  readonly title: string;
  /** What is being fetched, so the wait has a subject. */
  readonly description: string;
  /** How many placeholder rows to draw. Roughly the expected list length. */
  readonly rows?: number;
};

export function LoadingPage({ title, description, rows = 4 }: LoadingPageProps) {
  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>

        {/*
         * `role="status"` fa annunciare l'attesa a un lettore di schermo, che
         * altrimenti troverebbe una pagina senza contenuto e nessuna
         * spiegazione. È testo vero, non solo un'animazione.
         */}
        <p role="status" className="text-muted-foreground text-sm">
          {description}
        </p>
      </header>

      {/*
       * I rettangoli sono decorazione: dicono «sta arrivando una lista» a chi
       * vede, e nulla a chi ascolta, che ha già ricevuto la stessa
       * informazione dal testo qui sopra. Per questo sono nascosti alla
       * tecnologia assistiva invece di essere letti come righe vuote.
       */}
      <div aria-hidden="true" className="grid gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="bg-muted h-16 animate-pulse rounded-lg" />
        ))}
      </div>
    </main>
  );
}

type ErrorNoticeProps = {
  readonly title: string;
  /**
   * What the reader can do about it, in their own terms.
   *
   * Never the raw error: the message of a failed query can carry a connection
   * string or a fragment of somebody else's data, and a stack trace helps
   * nobody who is not holding the source code (§8.3).
   */
  readonly description: string;
  /**
   * Identifier of the failure, when the framework produced one.
   *
   * The one technical detail worth showing: it is how a reader points at
   * *this* failure when asking for help, and it discloses nothing on its own.
   */
  readonly reference?: string | undefined;
  /** Rendered by the caller, which owns the retry. */
  readonly action?: ReactNode;
};

export function ErrorNotice({ title, description, reference, action }: ErrorNoticeProps) {
  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>{description}</p>

          {reference ? (
            <p className="text-muted-foreground text-xs">
              Riferimento dell&apos;errore: <code className="font-mono">{reference}</code>
            </p>
          ) : null}

          {action}
        </CardContent>
      </Card>
    </main>
  );
}
