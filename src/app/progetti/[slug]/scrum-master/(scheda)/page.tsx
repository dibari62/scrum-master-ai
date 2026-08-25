import type { Metadata } from "next";
import Link from "next/link";

import { StatusPill } from "@/components/feedback/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { isSkillAvailable, skillKeySchema } from "@/domain";

import { runSprintReportAction, setSkillEnabledAction } from "../actions";
import { SKILLS } from "../labels";
import { loadScheda, loadSprints } from "../scheda";
import { SkillCard } from "./skill-card";

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
 *
 * **What was still wrong afterwards, and what this pass fixes.** The Product
 * Owner reported that he could not find «Salute dello sprint» here. It was on
 * the screen, described correctly, and its state — on or off — could only be
 * worked out by reading a paragraph to the end and noticing which button it
 * offered. Three things now answer that at a glance: a pill beside each name, a
 * line saying *where* the capability is used once on, and a summary at the top
 * naming what is on right now. The card also carries an anchor, so the dashboard
 * can link straight to it instead of to the top of a page one must then search.
 */
export default async function CapacitaPage({ params }: PageProps) {
  const { slug } = await params;

  const {
    agent,
    canConfigure,
    reportSkillEnabled,
    healthSkillEnabled,
    bottleneckSkillEnabled,
    digestSkillEnabled,
    questionSkillEnabled,
  } = await loadScheda(slug);
  const { closed, latestClosed } = await loadSprints(slug);

  const enabledNames = [
    reportSkillEnabled ? SKILLS["sprint-report"].name : null,
    healthSkillEnabled ? SKILLS["sprint-health"].name : null,
    bottleneckSkillEnabled ? SKILLS["bottleneck-detection"].name : null,
    digestSkillEnabled ? SKILLS["daily-digest"].name : null,
    questionSkillEnabled ? SKILLS["project-qa"].name : null,
  ].filter((name): name is string => name !== null);

  const notBuilt = Object.entries(SKILLS).filter(
    ([key]) => !isSkillAvailable(skillKeySchema.parse(key)),
  );

  return (
    <div className="grid gap-4">
      {/*
       * La risposta prima delle schede.
       *
       * «Quali sono accese» è la prima domanda che si fa chi arriva qui, e
       * finora si poteva rispondere solo leggendo tutte le schede fino in
       * fondo. Una riga sola in cima la chiude.
       */}
      <div className="grid gap-2">
        <p className="text-sm">
          <span className="font-medium">Accese ora: </span>
          {enabledNames.length === 0
            ? "nessuna. Finché non se ne accende una, questo Scrum Master AI non produce nulla."
            : `${enabledNames.join(" e ")}.`}
        </p>

        <p className="text-muted-foreground text-sm">
          Ogni capacità si accende per conto suo, e ognuna dice qui sotto dove la si usa una
          volta accesa: alcune si comandano da questa schermata, altre dalla dashboard del
          progetto. Quelle non ancora costruite sono elencate in fondo, senza interruttore:
          sono dichiarazioni di intenzione, non funzioni nascoste.
        </p>
      </div>

      {/*
       * `scroll-mt-24` riserva lo spazio dell'intestazione fissa: senza, un
       * collegamento con l'ancora porta la scheda esattamente sotto la barra
       * in cima, cioè fuori dalla vista di chi lo ha appena seguito.
       */}
      <Card id="resoconto-di-sprint" className="scroll-mt-24">
        <CardHeader>
          {/*
           * Un'intestazione vera, non un titolo finto.
           *
           * `CardTitle` rende un `div`: visivamente identico, ma chi naviga
           * saltando di intestazione in intestazione non lo incontra — e il
           * nome della capacità è esattamente ciò che deve poter trovare.
           *
           * Lo stato sta **accanto** all'intestazione e non dentro: il nome
           * accessibile di un titolo è il suo testo, e infilarci «Accesa» lo
           * farebbe annunciare come «Resoconto di sprint Accesa».
           */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-base leading-none font-semibold">
              {SKILLS["sprint-report"].name}
            </h2>

            <StatusPill tone={reportSkillEnabled ? "on" : "off"}>
              {reportSkillEnabled ? "Accesa" : "Spenta"}
            </StatusPill>
          </div>

          <CardDescription>{SKILLS["sprint-report"].produces}</CardDescription>

          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Dove si usa: </span>
            qui sotto, scegliendo uno sprint concluso. Il testo prodotto resta nella
            schermata «Resoconti», insieme ai numeri su cui si fonda.
          </p>
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
                   * capacità non è accesa il comando non c'è, e al suo posto c'è
                   * il modo di accenderla. Un pulsante che fallisse dicendo «non
                   * abilitata» sposterebbe sull'utente il compito di indovinare
                   * dove si abilita.
                   */}
                  <p className="text-muted-foreground text-sm">
                    Questa capacità è spenta, quindi il comando per generare un resoconto
                    non compare: si accende qui e resta accesa finché non la si spegne.
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
       *
       * L'`id` è quello a cui punta la dashboard: «non trovo Salute dello
       * sprint» si risolve portando chi arriva esattamente su questa scheda,
       * non in cima a una pagina in cui deve cercarla.
       */}
      <Card id="salute-dello-sprint" className="scroll-mt-24">
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-base leading-none font-semibold">
              {SKILLS["sprint-health"].name}
            </h2>

            <StatusPill tone={healthSkillEnabled ? "on" : "off"}>
              {healthSkillEnabled ? "Accesa" : "Spenta"}
            </StatusPill>
          </div>

          <CardDescription>{SKILLS["sprint-health"].produces}</CardDescription>

          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Dove si usa: </span>
            sulla{" "}
            <Link href={`/progetti/${slug}`} className="underline underline-offset-4">
              dashboard del progetto
            </Link>
            , nel riquadro subito sotto il semaforo: è lì che si chiede la spiegazione del
            giudizio, perché è lì che il giudizio si vede.
          </p>
        </CardHeader>

        <CardContent className="grid gap-3">
          <p className="text-sm">
            Il giudizio sullo sprint viene calcolato dal codice comunque, che questo
            interruttore sia acceso o spento. Ciò che si accende qui è soltanto la sua{" "}
            <strong>lettura a parole</strong>, scritta da un modello linguistico quando
            qualcuno la chiede.
          </p>

          {!canConfigure ? (
            <p className="text-muted-foreground text-sm">
              Serve un ruolo di amministratore per accendere o spegnere una capacità.
            </p>
          ) : healthSkillEnabled ? (
            <form action={setSkillEnabledAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="skillKey" value="sprint-health" />
              <input type="hidden" name="enable" value="0" />
              <Button type="submit" variant="outline">
                Disabilita la salute dello sprint
              </Button>
            </form>
          ) : (
            <form action={setSkillEnabledAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="skillKey" value="sprint-health" />
              <input type="hidden" name="enable" value="1" />
              <Button type="submit">Abilita la salute dello sprint</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/*
       * Le tre capacità aggiunte dopo, tutte con la stessa forma.
       *
       * Ognuna si usa dove stanno i dati che racconta, mai qui: una lettura
       * lontana da ciò che legge va creduta invece che verificata.
       */}
      <SkillCard
        slug={slug}
        skillKey="bottleneck-detection"
        anchor="collo-di-bottiglia"
        enabled={bottleneckSkillEnabled}
        canConfigure={canConfigure}
        subject="il collo di bottiglia"
        whereItIsUsed={
          <>
            nella pagina{" "}
            <Link href={`/progetti/${slug}/flusso`} className="underline underline-offset-4">
              Flusso di lavoro
            </Link>
            , sotto la tabella che mostra dove va il tempo.
          </>
        }
        note={
          <>
            Quale fase trattenga il lavoro è <strong>già calcolato</strong> e visibile in quella
            pagina, acceso o spento che sia questo interruttore. Qui si accende solo la lettura
            a parole.
          </>
        }
      />

      <SkillCard
        slug={slug}
        skillKey="daily-digest"
        anchor="digest-giornaliero"
        enabled={digestSkillEnabled}
        canConfigure={canConfigure}
        subject="il digest giornaliero"
        whereItIsUsed={
          <>
            sulla{" "}
            <Link href={`/progetti/${slug}`} className="underline underline-offset-4">
              dashboard del progetto
            </Link>
            , nel riquadro «Cosa è successo ieri».
          </>
        }
        note={
          <>
            Conta le ventiquattro ore precedenti e non può tacere ciò che è rimasto fermo: un
            riassunto di soli progressi non è più corto, è più rassicurante di quanto i fatti
            consentano.
          </>
        }
      />

      <SkillCard
        slug={slug}
        skillKey="project-qa"
        anchor="domande-sul-progetto"
        enabled={questionSkillEnabled}
        canConfigure={canConfigure}
        subject="le domande sul progetto"
        whereItIsUsed={
          <>
            nella pagina{" "}
            <Link href={`/progetti/${slug}/elementi`} className="underline underline-offset-4">
              Elementi
            </Link>
            , dove ci sono le fonti che la risposta cita.
          </>
        }
        note={
          <>
            La risposta cita sempre gli elementi su cui si basa, e se non trova nulla di
            pertinente lo dichiara. È l&apos;unica risposta del prodotto senza numeri accanto:
            le fonti sono ciò che la rende verificabile invece che da credere.
          </>
        }
      />

      {/*
       * Ciò che non c'è ancora, detto invece che taciuto — finché ce n'è.
       *
       * Con tutte e sei le capacità costruite questo riquadro non ha più nulla
       * da elencare, e un riquadro vuoto intitolato «Non ancora costruite» è
       * peggio della sua assenza: sembra un errore di caricamento. Al suo posto
       * si dichiara il fatto, che è un'informazione vera e non un elenco
       * mancante. Il riquadro torna da sé alla settima capacità dichiarata.
       */}
      {notBuilt.length === 0 ? (
        <Card className="bg-muted/40">
          <CardHeader>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-base leading-none font-semibold">Non ancora costruite</h2>
              <StatusPill tone="unavailable">Nessuna</StatusPill>
            </div>

            <CardDescription>
              Tutte le capacità dichiarate dal modello sono state costruite: ognuna ha il
              proprio interruttore qui sopra. Quando ne verrà dichiarata una nuova, comparirà
              in questo riquadro finché non sarà eseguibile.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="bg-muted/40">
          <CardHeader>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-base leading-none font-semibold">Non ancora costruite</h2>
              <StatusPill tone="unavailable">Nessun interruttore</StatusPill>
            </div>

            <CardDescription>
              Sono già nel modello e nel vocabolario del prodotto, ma nessuna di queste può
              essere eseguita in questa versione: non c&apos;è niente da accendere finché non
              vengono costruite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground grid gap-2 text-sm">
              {notBuilt.map(([key, skill]) => (
                <li key={key}>
                  <span className="text-foreground font-medium">{skill.name}</span> —{" "}
                  {skill.produces}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
