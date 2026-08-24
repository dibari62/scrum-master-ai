"use client";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/feedback/page-states";

/**
 * Shown when reading the roster fails.
 *
 * `"use client"` is unavoidable and is the reason this file is separate from
 * the page: an error boundary has to run in the browser to catch what the
 * rendering threw, and `reset` re-runs the failed render on a click.
 *
 * The error itself is never printed. A failure of a database read can carry a
 * connection string in its message, and a person reading "connect ECONNREFUSED"
 * learns nothing they can act on. The digest — an identifier the framework logs
 * alongside the real error on the server — is the honest middle ground.
 */
export default function PeopleError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorNotice
      title="Non è stato possibile caricare le persone"
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
