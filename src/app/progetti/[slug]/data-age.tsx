"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { describeAge, type DataFreshness } from "@/lib/projects/freshness";

import { synchroniseAction, type SyncFormState } from "./impostazioni/actions";

/**
 * L'età dei dati e i pulsanti per rimediarci, sulla schermata che li mostra.
 *
 * **Perché non basta il collegamento alle impostazioni.** Chi guarda un
 * burndown e legge «dati di ieri» ha bisogno di due cose nello stesso momento:
 * sapere che sono vecchi, e poterci fare qualcosa. Mandarlo su un'altra pagina
 * gli chiede di perdere il filo — e su una schermata piena di numeri, perdere il
 * filo significa quasi sempre non tornare.
 *
 * **Non è un duplicato del pannello delle impostazioni**, è lo stesso gesto
 * offerto dove nasce il bisogno: l'azione server è una sola, quindi non c'è una
 * seconda strada da tenere allineata. Cambia solo il posto da cui si preme.
 *
 * **L'esito resta qui e non fa un redirect.** Una lettura ha qualcosa da
 * raccontare — quante righe, o perché nessuna — e un redirect lo butterebbe via
 * proprio mentre la pagina si ricarica con i numeri nuovi.
 */

const INITIAL: SyncFormState = { status: "idle" };

export function DataAge({
  freshness,
  slug,
  canSync,
}: {
  readonly freshness: DataFreshness;
  readonly slug: string;
  /**
   * Se chi guarda può davvero avviare una lettura.
   *
   * Il controllo vero lo rifà l'azione: un pulsante nascosto non è
   * un'autorizzazione. Questo serve a non offrire un gesto che verrebbe
   * rifiutato — che è il modo più rapido per far perdere fiducia in tutti gli
   * altri pulsanti della pagina.
   */
  readonly canSync: boolean;
}) {
  const [state, action, pending] = useActionState(synchroniseAction, INITIAL);

  if (freshness.kind === "not-applicable") return null;

  const impostazioni = `/progetti/${slug}/impostazioni?sezione=dati`;

  const buttons = canSync ? (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Lettura in corso…" : "Leggi ora"}
      </Button>

      {/*
        «Rileggi tutto» compare solo dopo la prima lettura: prima sarebbe un
        doppione di «Leggi ora», e due pulsanti identici sono un invito a
        chiedersi quale sia quello giusto.
      */}
      {freshness.kind === "never" ? null : (
        <Button
          type="submit"
          name="completa"
          value="1"
          size="sm"
          variant="outline"
          disabled={pending}
        >
          Rileggi tutto
        </Button>
      )}
    </form>
  ) : null;

  const esito =
    state.status === "idle" ? null : (
      <p className={state.status === "error" ? "text-destructive text-sm" : "text-sm"}>
        {state.message}
      </p>
    );

  if (freshness.kind === "never") {
    /*
     * «Mai letto» non è un avviso: è il primo passo, e i primi passi hanno già
     * il loro riquadro qui sopra. Ripeterlo in rosso direbbe che qualcosa si è
     * rotto quando invece non è ancora cominciato.
     */
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
        <div className="grid gap-1">
          <p className="text-muted-foreground text-sm">
            Nessuna lettura da Jira finora.{" "}
            {canSync ? null : (
              <Link href={impostazioni} className="underline underline-offset-4">
                Configura la fonte dati
              </Link>
            )}
          </p>
          {esito}
        </div>
        {buttons}
      </div>
    );
  }

  const quando = describeAge(freshness.hours);
  const stale = freshness.kind === "stale";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2${
        stale ? " border-muted-foreground/40 border-dashed" : ""
      }`}
    >
      <div className="grid gap-1">
        {stale ? (
          <p className="text-sm">
            <strong>Dati letti da Jira {quando}.</strong> I numeri qui sotto sono corretti per
            quei dati, ma lo sprint nel frattempo è andato avanti.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Dati letti da Jira {quando}.</p>
        )}
        {esito}
      </div>

      {buttons}
    </div>
  );
}
