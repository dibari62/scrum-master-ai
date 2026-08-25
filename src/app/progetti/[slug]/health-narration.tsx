"use client";

import Link from "next/link";
import { useActionState } from "react";

import { ProvenanceBlock } from "@/components/feedback/provenance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { SIGNAL_TITLES } from "@/lib/health-words";

import { narrateHealthAction, type NarrationState } from "./health-actions";

/**
 * The button that asks for an explanation, and the explanation itself.
 *
 * **Why nothing is generated when the page opens.** A page that spends money to
 * be looked at is a page nobody leaves open, and most visits to a dashboard are
 * a glance at the colour rather than a request for prose. So the reader asks.
 *
 * **Why the card now says the verdict in its own title.** The Product Owner read
 * «Spiegazione del giudizio · Chiedi una spiegazione» and could not tell what
 * would arrive: an explanation of the page, of the metrics, of the product? A
 * title naming *this* verdict — «Perché il giudizio dice “Critico”» — and a list
 * of what the answer will contain turn a leap of faith into a decision.
 *
 * A client component because the answer is not stored anywhere: it exists only
 * as the result of this request, which is precisely what `useActionState` holds.
 */

const INITIAL: NarrationState = { status: "idle" };

type HealthNarrationProps = {
  readonly slug: string;
  /** Whether the capability is switched on for this project's agent. */
  readonly enabled: boolean;
  /** The verdict in words, already chosen by the page. Never recomputed here. */
  readonly verdictLabel: string;
  /**
   * How many scheduled checks exist on this sprint.
   *
   * Only used to say, **before** the request, whether the answer can contain a
   * trend: with fewer than two checks there is nothing to compare, and the model
   * is required to omit it. Promising an answer that will not come is the kind
   * of small lie that makes a reader stop trusting the rest of the screen.
   */
  readonly historyCount: number;
};

export function HealthNarration({
  slug,
  enabled,
  verdictLabel,
  historyCount,
}: HealthNarrationProps) {
  const [state, action, pending] = useActionState(narrateHealthAction, INITIAL);

  const title = `Perché il giudizio dice «${verdictLabel}»`;

  if (!enabled) {
    /*
     * Ciò che manca si dice, e si dice dove si accende (R6).
     *
     * Un riquadro assente lascerebbe credere che la funzione non esista; un
     * pulsante che rifiuta sempre sarebbe peggio ancora. Il collegamento punta
     * all'ancora della capacità e non alla cima della scheda: «non trovo Salute
     * dello sprint» è un difetto già segnalato, e portare a una pagina in cui
     * bisogna comunque cercarla non lo risolve.
     */
    return (
      <Card>
        <CardHeader>
          <h3 className="text-base leading-none font-semibold">{title}</h3>
          <CardDescription>
            Lo Scrum Master AI saprebbe dirlo: leggerebbe i segnali qui sopra, spiegherebbe
            perché insieme portano a questo giudizio e come si è mosso nei giorni scorsi. Su
            questo progetto la capacità che lo fa — si chiama «Salute dello sprint» — è
            spenta, quindi qui non c&apos;è nulla da chiedere.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-muted-foreground text-sm">
            Il semaforo qui sopra continua a funzionare comunque: lo calcola il codice e non
            dipende dalla capacità. Ciò che manca è soltanto la sua lettura a parole.
          </p>

          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href={`/progetti/${slug}/scrum-master#salute-dello-sprint`}>
              Vai a «Salute dello sprint»
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base leading-none font-semibold">{title}</h3>
        <CardDescription>
          Il giudizio qui sopra è calcolato dal codice, segnale per segnale. Lo Scrum Master
          AI non lo ricalcola: lo legge e ne scrive la spiegazione a parole, quella che
          serve per portarlo in una riunione senza doverla scrivere a mano.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <h4 className="text-sm font-medium">Cosa ricevi premendo il pulsante</h4>

          <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
            <li>
              Il legame fra i segnali: perché quei cinque numeri, letti insieme, danno
              questo giudizio e non un altro.
            </li>
            <li>
              {historyCount >= 2
                ? `Come il giudizio si è mosso: su questo sprint risultano ${historyCount} controlli automatici, quindi c'è qualcosa da confrontare.`
                : `Nessun andamento, e il motivo: servono almeno due controlli automatici su questo sprint e finora ${
                    historyCount === 1 ? "ne risulta uno solo" : "non ne risulta nessuno"
                  }. Un andamento raccontato senza due misure da confrontare sarebbe inventato, quindi viene omesso.`}
            </li>
            <li>
              Le stesse cose senza il gergo della squadra, leggibili da chi non ci lavora
              dentro.
            </li>
            <li>
              Nessuna cifra nuova e nessun consiglio su cosa fare: i numeri restano quelli
              misurati qui sopra, e questo agente osserva senza prescrivere.
            </li>
          </ul>
        </div>

        <div className="grid gap-2">
          <form action={action}>
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Sto leggendo i segnali…" : "Chiedi una spiegazione del giudizio"}
            </Button>
          </form>

          <p className="text-muted-foreground text-xs">
            Non parte da sola all&apos;apertura della pagina: ogni richiesta è una chiamata a
            un modello linguistico, e si paga. Ci vuole qualche secondo.
          </p>
        </div>

        {/*
         * L'esito arriva dopo, quindi va annunciato.
         *
         * Il contenitore esiste anche da vuoto: una regione `aria-live` inserita
         * insieme al testo non viene letta, perché il lettore di schermo osserva
         * i cambiamenti *dentro* una regione che stava già lì.
         */}
        <div aria-live="polite" className="grid min-w-0 gap-3">
          {pending ? (
            <p className="text-muted-foreground text-sm">
              Sto leggendo i cinque segnali e i controlli dei giorni scorsi.
            </p>
          ) : null}

          {state.status === "refused" ? (
            <div className="border-destructive/50 grid gap-1 rounded-md border p-3 text-sm">
              <p className="font-medium">La spiegazione non è stata prodotta</p>
              <p className="text-muted-foreground">{state.message}</p>
              <p className="text-muted-foreground text-xs">
                Il giudizio qui sopra resta valido: lo calcola il codice e non dipende da
                questa richiesta.
              </p>
            </div>
          ) : null}

          {state.status === "ok" ? (
            <ProvenanceBlock
              provenance={state.origin === "model" ? "generated" : "computed"}
              label={state.origin === "model" ? "Testo generato" : "Testo scritto dal codice"}
              note={
                state.origin === "model"
                  ? "Interpretazione di un modello linguistico, non una misura: le cifre restano quelle del semaforo qui sopra, ed è lì che si controllano. Non viene conservato — descrive lo stato di adesso."
                  : "Su questo ambiente non è configurato alcun fornitore di modelli: il codice riporta i segnali oltre soglia e come si è mosso il verdetto, senza aggiungerci una lettura. Non viene conservato — descrive lo stato di adesso."
              }
            >
              <div className="grid gap-3 text-sm">
                <p>{state.narrative.situation}</p>

                {state.narrative.observations.length > 0 ? (
                  <div className="grid gap-2">
                    <h5 className="text-xs font-medium">Su quali segnali si fonda</h5>

                    {/*
                     * Ogni osservazione porta il nome del segnale da cui nasce.
                     *
                     * È l'unico modo per andare a controllare: un'affermazione
                     * che non dice su quale misura si regge non si può né
                     * verificare né smentire, e a quel punto vale quanto
                     * un'opinione.
                     */}
                    <dl className="grid gap-2">
                      {state.narrative.observations.map((observation) => (
                        <div key={observation.signalId} className="grid gap-0.5">
                          <dt className="font-medium">
                            {SIGNAL_TITLES[observation.signalId]}
                          </dt>
                          <dd className="text-muted-foreground">{observation.observation}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}

                {state.narrative.trend === undefined ? null : (
                  <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">
                      Come si è mosso:{" "}
                    </span>
                    {state.narrative.trend}
                  </p>
                )}
              </div>
            </ProvenanceBlock>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
