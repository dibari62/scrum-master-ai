"use client";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/feedback/page-states";

/** Shown when reading the impediments fails. The error itself is never printed. */
export default function ImpedimentsError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <ErrorNotice
      title="Non è stato possibile caricare gli impedimenti"
      description="Il registro non è stato letto. Nessun dato è stato modificato: si può riprovare senza conseguenze."
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
