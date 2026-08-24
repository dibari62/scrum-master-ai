import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { isSkillAvailable, skillKeySchema } from "@/domain";

import { runSprintReportAction, setSkillEnabledAction } from "../actions";
import { SKILLS } from "../labels";
import { loadScheda, loadSprints } from "../scheda";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Cosa può fare · ${slug} · Scrum Master AI` };
}

/**
 * The capabilities, and the one place anything is actually asked for.
 *
 * This is the first screen because it is the only one that produces something.
 * The page it replaced opened with configuration — the answer to a question the
 * reader has not yet had the chance to ask — and buried the single useful
 * action in the middle, after two technical sections.
 */
export default async function CapacitaPage({ params }: PageProps) {
  const { slug } = await params;

  const { agent, canConfigure, reportSkillEnabled, healthSkillEnabled } = await loadScheda(slug);
  const { closed, latestClosed } = await loadSprints(slug);

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Ogni capacità si accende per conto suo. Quelle non ancora costruite sono elencate
        in fondo: sono dichiarazioni di intenzione, non funzioni nascoste.
      </p>

      <Card>
        <CardHeader>
          {/*
           * Un'intestazione vera, non un titolo finto.
           *
           * `CardTitle` rende un `div`: visivamente identico, ma chi naviga
           * saltando di intestazione in intestazione non lo incontra — e il
           * nome della capacità è esattamente ciò che deve poter trovare.
           */}
          <h2 className="text-base leading-none font-semibold">
            {SKILLS["sprint-report"].name}
          </h2>
          <CardDescription>{SKILLS["sprint-report"].produces}</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-3">
          {latestClosed ? (
            <>
              <p className="text-sm">
                Si genera su uno sprint <strong>concluso</strong>: su uno ancora aperto
                direbbe al passato numeri destinati a cambiare.
              </p>

              {!canConfigure ? (
                <p className="text-muted-foreground text-sm">
                  Serve un ruolo di amministratore per generare un resoconto.
                </p>
              ) : reportSkillEnabled ? (
                <div className="grid gap-3">
                  {/*
                   * Si sceglie lo sprint, non lo si subisce.
                   *
                   * Il comando era legato all'ultimo sprint concluso e basta:
                   * gli altri chiusi non avevano un resoconto e non c'era modo
                   * di produrlo. Il server verifica comunque che lo sprint
                   * appartenga al progetto e sia chiuso, quindi la scelta non
                   * allarga ciò che è permesso — rende raggiungibile ciò che
                   * già lo era.
                   */}
                  <form
                    action={runSprintReportAction}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="slug" value={slug} />

                    <div className="grid gap-1">
                      <label htmlFor="sprintId" className="text-muted-foreground text-xs">
                        Sprint concluso
                      </label>
                      <select
                        id="sprintId"
                        name="sprintId"
                        defaultValue={latestClosed.id}
                        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                      >
                        {closed.map((sprint) => (
                          <option key={sprint.id} value={sprint.id}>
                            {sprint.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button type="submit" disabled={agent.status === "suspended"}>
                      Genera il resoconto
                    </Button>
                  </form>

                  <form action={setSkillEnabledAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="skillKey" value="sprint-report" />
                    <input type="hidden" name="enable" value="0" />
                    {/*
                     * L'etichetta nomina la capacità, non «la skill».
                     *
                     * Con più capacità sulla stessa schermata, due pulsanti
                     * identici costringono a dedurre dalla posizione a quale
                     * si riferiscano — e chi ascolta la pagina la posizione non
                     * ce l'ha.
                     */}
                    <Button type="submit" variant="outline">
                      Disabilita il resoconto di sprint
                    </Button>
                  </form>
                </div>
              ) : (
                <>
                  {/*
                   * La configurazione viene rispettata, non decorata: se la
                   * skill non è abilitata il comando non c'è, e al suo posto c'è
                   * il modo di abilitarla. Un pulsante che fallisse dicendo «non
                   * abilitata» sposterebbe sull'utente il compito di indovinare
                   * dove si abilita.
                   */}
                  <p className="text-muted-foreground text-sm">
                    Il resoconto di sprint non è fra le skill abilitate su questo Scrum
                    Master AI.
                  </p>

                  <form action={setSkillEnabledAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="skillKey" value="sprint-report" />
                    <input type="hidden" name="enable" value="1" />
                    <Button type="submit">Abilita il resoconto di sprint</Button>
                  </form>
                </>
              )}
            </>
          ) : (
            /*
             * Il motivo scritto, non solo un pulsante grigio. Un comando
             * disattivato senza spiegazione lascia chi legge a indovinare se
             * manchi un permesso, un dato o se sia rotto qualcosa.
             */
            <p className="text-muted-foreground text-sm">
              Nessuno sprint concluso: il resoconto di fine sprint si può generare solo su
              uno sprint chiuso, perché su uno ancora aperto direbbe al passato numeri
              destinati a cambiare.
            </p>
          )}
        </CardContent>
      </Card>

      {/*
       * La seconda capacità, e il motivo per cui il comando non è qui.
       *
       * La spiegazione si chiede dov'è il giudizio che spiega: portarla su
       * questa schermata significherebbe leggere un testo che commenta un
       * semaforo non visibile. Qui resta ciò che qui si decide — se la capacità
       * è accesa — e la strada per arrivarci.
       */}
      <Card>
        <CardHeader>
          <h2 className="text-base leading-none font-semibold">
            {SKILLS["sprint-health"].name}
          </h2>
          <CardDescription>{SKILLS["sprint-health"].produces}</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-3">
          {!canConfigure ? (
            <p className="text-muted-foreground text-sm">
              Serve un ruolo di amministratore per accendere o spegnere una capacità.
            </p>
          ) : healthSkillEnabled ? (
            <div className="grid gap-3">
              <p className="text-sm">
                È accesa. Il pulsante per chiederla si trova sulla{" "}
                <Link href={`/progetti/${slug}`} className="underline underline-offset-4">
                  dashboard del progetto
                </Link>
                , sotto il giudizio che spiega.
              </p>

              <form action={setSkillEnabledAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="skillKey" value="sprint-health" />
                <input type="hidden" name="enable" value="0" />
                <Button type="submit" variant="outline">
                  Disabilita la salute dello sprint
                </Button>
              </form>
            </div>
          ) : (
            <>
              <p className="text-sm">
                Il giudizio sullo sprint viene calcolato comunque, anche a capacità spenta:
                quello che si accende qui è soltanto la sua <strong>lettura</strong>.
              </p>

              <form action={setSkillEnabledAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="skillKey" value="sprint-health" />
                <input type="hidden" name="enable" value="1" />
                <Button type="submit">Abilita la salute dello sprint</Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      {/*
       * Ciò che non c'è ancora, detto invece che taciuto.
       *
       * Il modello dichiara sei capacità e ne esegue tre. Nasconderle
       * lascerebbe credere che il prodotto finisca qui; mostrarle come pulsanti
       * spenti lascerebbe credere che siano rotte.
       */}
      <Card className="bg-muted/40">
        <CardHeader>
          <h2 className="text-base leading-none font-semibold">Non ancora costruite</h2>
          <CardDescription>
            Sono già nel modello e nel vocabolario del prodotto, ma nessuna di queste può
            essere eseguita in questa versione.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground grid gap-2 text-sm">
            {Object.entries(SKILLS)
              .filter(([key]) => !isSkillAvailable(skillKeySchema.parse(key)))
              .map(([key, skill]) => (
                <li key={key}>
                  <span className="text-foreground font-medium">{skill.name}</span> —{" "}
                  {skill.produces}
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
