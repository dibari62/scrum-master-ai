"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { testModelAction, type ModelTestState } from "./actions";

/**
 * «Prova la connessione»: si scopre subito se la chiave è quella giusta.
 *
 * **Perché è un pannello a sé.** La stessa ragione del pulsante «Leggi ora»: in
 * HTML un `form` non può contenerne un altro, e salvare una configurazione è un
 * gesto diverso dal provarla. Ma soprattutto perché la prova ha un esito da
 * leggere, e il modulo delle impostazioni conferma con un redirect che lo
 * butterebbe via.
 *
 * **Sta qui e non nel diario dello Scrum Master AI**, dove pure una prova
 * esiste, perché questo è il punto in cui la chiave viene incollata. Una
 * verifica che si trova due schermate più in là, e che pretende un agente già
 * creato, è una verifica che nessuno fa.
 */

const INITIAL: ModelTestState = { status: "idle" };

export function ModelTestPanel({
  slug,
  provider,
  ready,
}: {
  readonly slug: string;
  readonly provider: string;
  /** Se c'è abbastanza configurazione da valere il tentativo. */
  readonly ready: boolean;
}) {
  const [state, action, pending] = useActionState(testModelAction, INITIAL);

  return (
    <div className="mb-6 grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Collegamento al modello</p>
          <p className="text-muted-foreground text-sm">
            {provider === "fake"
              ? "Il modello dimostrativo risponde sempre e non chiama nessun fornitore: non c'è un collegamento da provare."
              : "Una richiesta minima, per sapere se la chiave e il nome del modello sono quelli giusti. Costa qualche frazione di centesimo."}
          </p>
        </div>

        <form action={action}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" variant="outline" disabled={pending || !ready}>
            {pending ? "Prova in corso…" : "Prova la connessione"}
          </Button>
        </form>
      </div>

      {!ready ? (
        <p className="text-muted-foreground text-sm">
          Scegli un fornitore e salva la chiave qui sotto: senza, non c&apos;è nulla da
          provare.
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}

      {state.status === "skipped" ? (
        <p className="text-muted-foreground text-sm">{state.message}</p>
      ) : null}

      {state.status === "done" ? (
        <div className="grid gap-1 text-sm">
          <p>{state.message}</p>
          {/*
            La risposta del modello si mostra, non si riassume.
            «Ha funzionato» è una nostra affermazione; la frase che è tornata
            indietro è la prova, ed è l'unica cosa che nessuno può aver inventato
            da questa parte.
          */}
          <p className="text-muted-foreground">
            Ha risposto: <span className="font-mono">{state.reply}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
