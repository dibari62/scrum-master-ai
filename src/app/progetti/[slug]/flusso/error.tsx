"use client";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/feedback/page-states";

/** Shown when reading the board fails. The error itself is never printed. */
export default function FlowError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorNotice
      title="Non è stato possibile caricare il flusso di lavoro"
      description="La bacheca non è stata letta. Nessun dato è stato modificato: si può riprovare senza conseguenze."
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
