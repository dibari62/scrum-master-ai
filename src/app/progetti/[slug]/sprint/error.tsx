"use client";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/feedback/page-states";

/**
 * Shown when reading the sprints fails.
 *
 * `"use client"` is unavoidable: an error boundary runs in the browser, and
 * `reset` re-runs the render that failed. The error object is never printed —
 * only the digest the framework logs beside the real error on the server.
 */
export default function SprintsError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorNotice
      title="Non è stato possibile caricare gli sprint"
      description="L'elenco non è stato letto. Nessun dato è stato modificato: si può riprovare senza conseguenze."
      reference={error.digest}
      action={
        <div>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            Riprova
          </Button>
        </div>
      }
    />
  );
}
