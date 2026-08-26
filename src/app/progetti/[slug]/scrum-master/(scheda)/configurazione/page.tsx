import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ESTIMATION_SCALE_LABELS, estimationScaleSchema, isKnownSkillKey } from "@/domain";
import { formatNumber } from "@/lib/format";

import { setEstimationScaleAction } from "../../actions";
import { AUTONOMY, PERSONA, SKILLS, STATUS } from "../../labels";
import { loadScheda } from "../../scheda";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Configurazione · ${slug} · Scrum Master AI` };
}

/**
 * How it is set up, and what it will never do.
 *
 * A screen of its own rather than the opening of the card: it is the answer to
 * a question a reader asks *after* knowing what the thing does, not before.
 */
export default async function ConfigurazionePage({ params }: PageProps) {
  const { slug } = await params;
  const { agent, context, canConfigure } = await loadScheda(slug);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <h2 className="text-base leading-none font-semibold">Come si comporta</h2>
          <CardDescription>
            Scelte fatte alla creazione. Cambiano il tono e i confini di ciò che produce,
            non i numeri che legge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
           * Ogni valore con la sua spiegazione, non solo con il suo nome.
           *
           * L'intestazione della scheda diceva «Facilitatore · Osserva ·
           * Attivo»: quattro parole di fila, di cui almeno due incomprensibili
           * a chi non ha compilato il modulo di creazione. Le spiegazioni
           * esistevano già in quel modulo e venivano buttate via proprio qui.
           */}
          <dl className="grid gap-4 text-sm">
            <div className="grid gap-0.5">
              <dt className="font-medium">Stato: {STATUS[agent.status].label}</dt>
              <dd className="text-muted-foreground">{STATUS[agent.status].explanation}</dd>
            </div>

            <div className="grid gap-0.5">
              <dt className="font-medium">
                Quanto può spingersi: {AUTONOMY[agent.autonomyLevel].label}
              </dt>
              <dd className="text-muted-foreground">
                {AUTONOMY[agent.autonomyLevel].explanation}
              </dd>
            </div>

            <div className="grid gap-0.5">
              <dt className="font-medium">Come si pone: {PERSONA[agent.persona].label}</dt>
              <dd className="text-muted-foreground">
                {PERSONA[agent.persona].explanation}
              </dd>
            </div>

            <div className="grid gap-0.5">
              <dt className="font-medium">
                Lingua in cui scrive: {agent.language === "it" ? "Italiano" : agent.language}
              </dt>
              <dd className="text-muted-foreground">
                Vale per il testo che produce, non per i dati che legge.
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base leading-none font-semibold">Entro quali limiti</h2>
          <CardDescription>
            Servono a impedire che una capacità costi più di quanto valga, e si vedono qui
            perché nulla di ciò che spende debba restare invisibile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm">
            <div className="grid gap-0.5">
              <dt className="font-medium">Capacità accese</dt>
              <dd className="text-muted-foreground">
                {agent.enabledSkillKeys.length === 0
                  ? "Nessuna: lo Scrum Master AI esiste ma non può fare nulla finché non se ne accende una."
                  : agent.enabledSkillKeys
                      .map((key) =>
                        isKnownSkillKey(key)
                          ? SKILLS[key].name
                          : `${key} (non più disponibile in questa versione)`,
                      )
                      .join(", ")}
              </dd>
            </div>

            <div className="grid gap-0.5">
              <dt className="font-medium">
                Al massimo {formatNumber(agent.policy.maxRunsPerDay)} esecuzioni al giorno
              </dt>
              <dd className="text-muted-foreground">
                Un tetto giornaliero: oltre questo numero le richieste vengono rifiutate.
                Esiste perché ogni esecuzione costa, e un difetto che ne innescasse mille
                se ne accorgerebbe solo la bolletta.
              </dd>
            </div>

            <div className="grid gap-0.5">
              <dt className="font-medium">
                Budget per esecuzione:{" "}
                {agent.policy.maxTokensPerRun === null
                  ? "quello che dichiara la capacità stessa"
                  : `${formatNumber(agent.policy.maxTokensPerRun)} token`}
              </dt>
              <dd className="text-muted-foreground">
                I modelli linguistici si pagano a <em>token</em>, all&apos;incirca dei
                frammenti di parola: un resoconto ne consuma qualche centinaio. Il budget è
                il tetto per una singola esecuzione, e superarlo la ferma prima di partire
                invece che a metà.
              </dd>
            </div>

            {context ? (
              <div className="grid gap-0.5">
                <dt className="font-medium">
                  Sprint di {formatNumber(context.sprintLengthDays)} giorni
                </dt>
                <dd className="text-muted-foreground">
                  La durata abituale degli sprint di questo progetto, usata per capire a
                  che punto sia quello in corso.
                </dd>
              </div>
            ) : null}

            {context ? (
              <div className="grid gap-0.5">
                <dt className="font-medium">
                  Scala di stima · {ESTIMATION_SCALE_LABELS[context.estimationScale]}
                </dt>
                <dd className="text-muted-foreground grid gap-2">
                  <span>
                    {context.estimationScale === "free"
                      ? "Nessuna scala dichiarata: qualunque stima è ammessa, e il portale non segnala deviazioni."
                      : "I valori che questa squadra può usare per stimare. Le stime che non vi appartengono vengono segnalate fra gli elementi, mai corrette."}
                  </span>

                  {canConfigure ? (
                    <form
                      action={setEstimationScaleAction}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="slug" value={slug} />
                      <label className="sr-only" htmlFor="estimationScale">
                        Scala di stima
                      </label>
                      <select
                        id="estimationScale"
                        name="estimationScale"
                        defaultValue={context.estimationScale}
                        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                      >
                        {estimationScaleSchema.options.map((scale) => (
                          <option key={scale} value={scale}>
                            {ESTIMATION_SCALE_LABELS[scale]}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="sm">
                        Cambia scala
                      </Button>
                    </form>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/*
       * I divieti si vedono ma non si toccano.
       *
       * Mostrarli come impostazioni disattivabili suggerirebbe che si possano
       * spegnere; nasconderli lascerebbe credere che siano una dimenticanza.
       */}
      <Card>
        <CardHeader>
          <h2 className="text-base leading-none font-semibold">Cosa non farà mai</h2>
          <CardDescription>
            Valgono per ogni Scrum Master AI, non sono configurabili e non esiste un modo
            di spegnerle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground grid gap-1 text-sm">
            <li>Nessuna valutazione delle singole persone, nessuna classifica.</li>
            <li>Nessuna deduzione sullo stato d&apos;animo di un individuo.</li>
            <li>
              Il testo proveniente dalle fonti è un dato da leggere, mai un&apos;istruzione
              da eseguire.
            </li>
            <li>I numeri sono calcolati in codice: il modello li racconta, non li produce.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
