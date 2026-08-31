"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { synchroniseAction, type SyncFormState } from "./actions";

/**
 * «Leggi ora»: la prima volta che il portale va a prendere dati veri.
 *
 * **Perché è un modulo a sé e non un pulsante dentro quello delle impostazioni.**
 * Due ragioni, e nessuna è estetica. In HTML un `form` non può contenerne un
 * altro, quindi tecnicamente non ci starebbe. Ma soprattutto sono due gesti
 * diversi: salvare una configurazione è dire *come* si legge, premere qui è
 * dire *adesso*. Chi corregge un refuso nell'indirizzo del sito non deve
 * ritrovarsi ad aver consumato una lettura.
 *
 * **La conferma resta sullo schermo.** Le altre azioni di questa pagina
 * confermano con un redirect, perché il loro modulo si rimonta e uno stato di
 * React non sopravvivrebbe. Qui non c'è nulla da rimontare e c'è un esito da
 * leggere — quante righe, o perché no — che un redirect butterebbe via.
 */

const INITIAL: SyncFormState = { status: "idle" };

export function SyncPanel({
  slug,
  connector,
  ready,
  lastSyncedAt,
}: {
  readonly slug: string;
  readonly connector: string | null;
  /** Se la configurazione è completa abbastanza da provarci. */
  readonly ready: boolean;
  readonly lastSyncedAt: Date | null;
}) {
  const [state, action, pending] = useActionState(synchroniseAction, INITIAL);

  /*
   * Il pannello non compare affatto per una fonte che non si legge da qui.
   *
   * I dati di esempio si caricano da riga di comando, e un pulsante che
   * rifiutasse sempre insegnerebbe soltanto a non fidarsi dei pulsanti.
   */
  if (connector !== "jira") return null;

  return (
    <div className="mb-6 grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Lettura da Jira</p>
          <p className="text-muted-foreground text-sm">
            {lastSyncedAt
              ? `Ultima lettura riuscita: ${lastSyncedAt.toLocaleString("it-IT")}.`
              : "Non è mai stata fatta una lettura. La prima prende tutta la storia disponibile, quindi può richiedere qualche minuto."}
          </p>
        </div>

        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" disabled={pending || !ready}>
            {pending ? "Lettura in corso…" : "Leggi ora"}
          </Button>

          {/*
            Il secondo pulsante compare solo quando ha senso premerlo.
            Prima della prima lettura «rileggi tutto» e «leggi» sono la stessa
            cosa, e due pulsanti identici sono un invito a chiedersi quale sia
            quello giusto.
          */}
          {lastSyncedAt ? (
            <Button
              type="submit"
              name="completa"
              value="1"
              variant="outline"
              disabled={pending || !ready}
            >
              Rileggi tutto
            </Button>
          ) : null}
        </form>
      </div>

      {lastSyncedAt ? (
        <p className="text-muted-foreground text-sm">
          «Leggi ora» chiede a Jira solo ciò che è cambiato dall&apos;ultima volta.
          «Rileggi tutto» ignora quella data e richiede l&apos;intera storia: serve
          quando mancano elementi che su Jira ci sono già.
        </p>
      ) : null}

      {!ready ? (
        <p className="text-muted-foreground text-sm">
          Completa e salva la configurazione qui sotto: senza indirizzo, chiave del
          progetto, board, indirizzo dell&apos;account e token non c&apos;è nulla da leggere.
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}

      {state.status === "done" ? (
        <p className="text-sm">
          {state.message}{" "}
          <span className="text-muted-foreground">
            Rileggere non duplica nulla: ogni record viene riconosciuto e aggiornato.
          </span>
        </p>
      ) : null}
    </div>
  );
}
