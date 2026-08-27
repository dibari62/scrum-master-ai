import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BarChart, type Bar } from "@/components/charts/bar-chart";
import { BurndownChart } from "@/components/charts/burndown-chart";
import { HealthBanner } from "@/components/charts/health-banner";
import { MetricCard } from "@/components/charts/metric-card";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { organizationIdSchema, type HealthVerdict } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { available } from "@/metrics";

import { loadProjectDashboard, type SprintMetrics } from "../data";
import { HealthNarration } from "./health-narration";
import { DailyDigest } from "./daily-digest";
import { ForecastTable } from "./forecast-table";
import {
  presentCount,
  presentDuration,
  presentEstimates,
  presentPercent,
  presentSignal,
  VERDICT_WORDS,
} from "../present";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} · Scrum Master AI` };
}

/**
 * The dot beside a kept verdict.
 *
 * Decoration: the word is right next to it, and a screen reader that announced
 * the colour as well would say the same thing twice.
 */
const VERDICT_DOT: Readonly<Record<HealthVerdict, string>> = {
  respected: "bg-emerald-600",
  watch: "bg-amber-500",
  critical: "bg-destructive",
  "not-evaluable": "bg-muted-foreground/40",
};

function sprintLabel(entry: SprintMetrics): string {
  return entry.sprint.name.replace(/^Sprint \d+ — /, "");
}

/**
 * Says how many of the mid-sprint additions were interruptions.
 *
 * > «We've had three **unplanned items** … this is useful to remember when you
 * > do the sprint retrospective.» (pag. 60)
 *
 * The total alone cannot tell a team that accepted more work from a team that
 * was interrupted, and those are two different conversations to have at the
 * retrospective.
 *
 * When nothing is declared it says so, rather than implying everything was
 * planned: `null` on a scope event means the source has no field for it, which
 * is the normal state of most tools.
 */
function unplannedHint(result: SprintMetrics["scopeChange"]): string {
  const base = "Elementi entrati a sprint iniziato.";
  if (!result.available || result.value.addedCount === 0) return base;

  const { unplannedAdditions, undeclaredAdditions, addedCount } = result.value;

  if (unplannedAdditions === 0 && undeclaredAdditions === addedCount) {
    return `${base} Nessuno dichiara se sia stato un'interruzione.`;
  }

  // «1 non lo dichiarano» fa sembrare generato un testo che invece è scritto.
  const interruptions =
    unplannedAdditions === 1 ? "1 è un'interruzione" : `${unplannedAdditions} sono interruzioni`;
  const silent =
    undeclaredAdditions === 1
      ? "1 non lo dichiara"
      : `${undeclaredAdditions} non lo dichiarano`;

  return undeclaredAdditions === 0
    ? `${base} Di questi, ${interruptions}.`
    : `${base} Di questi, ${interruptions}; ${silent}.`;
}

export default async function ProjectDashboardPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;

  /**
   * The reference instant is decided here and passed down.
   *
   * `src/metrics` refuses to read the clock so its results stay reproducible;
   * choosing the instant at the edge is what makes that discipline usable
   * rather than merely principled.
   */
  const asOf = new Date();

  const dashboard = await loadProjectDashboard(
    organizationIdSchema.parse(session.organizationId),
    slug,
    asOf,
  );

  if (!dashboard) notFound();

  const { project, sprints, current, flow, wip } = dashboard;

  const velocityBars: readonly Bar[] = sprints.map((entry) => ({
    label: sprintLabel(entry),
    value: entry.velocity.available ? (entry.velocity.value.points ?? null) : null,
    display: entry.velocity.available
      ? presentEstimates(entry.velocity.value)
      : "non disponibile",
  }));

  const cycleBars: readonly Bar[] = sprints.map((entry) => ({
    label: sprintLabel(entry),
    value: entry.flow.cycleTime.median.available ? entry.flow.cycleTime.median.value : null,
    display: entry.flow.cycleTime.median.available
      ? formatDuration(entry.flow.cycleTime.median.value)
      : "non disponibile",
    // The most recent sprint is the one being asked about, so it is marked.
    highlight: entry.sprint.id === current?.sprint.id,
  }));

  const carryBars: readonly Bar[] = sprints.map((entry) => ({
    label: sprintLabel(entry),
    value: entry.carryOver.available ? entry.carryOver.value.items.length : null,
    display: entry.carryOver.available
      ? `${formatNumber(entry.carryOver.value.items.length)} su ${formatNumber(entry.carryOver.value.consideredCount)}`
      : "non disponibile",
  }));

  const cycleMedian = presentDuration(flow.cycleTime.median);
  const cycleP85 = presentDuration(flow.cycleTime.p85);
  const leadMedian = presentDuration(flow.leadTime.median);
  const wipNow = presentCount(wip);
  const reopen = presentPercent(flow.reopenRate, 1);
  const efficiency = presentPercent(flow.flowEfficiency.median, 0);
  const reviewWait = presentDuration(flow.reviewWait.median);

  const addedNow = current
    ? presentCount(
        current.scopeChange.available
          ? available(current.scopeChange.value.addedCount, current.scopeChange.sampleSize)
          : current.scopeChange,
      )
    : null;

  const carriedNow = current
    ? presentCount(
        current.carryOver.available
          ? available(current.carryOver.value.items.length, current.carryOver.sampleSize)
          : current.carryOver,
      )
    : null;

  const sprintCycle = current ? presentDuration(current.flow.cycleTime.median) : null;

  const elementi = `/progetti/${project.slug}/elementi`;

  return (
    <main className="app-shell grid gap-10 py-10">
      <header className="grid gap-2">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name },
          ]}
        />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {project.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {formatNumber(sprints.length)} sprint ·{" "}
              {formatNumber(dashboard.peopleCount)} persone · dati al{" "}
              {formatDate(dashboard.asOf)}
            </p>
          </div>

          {/*
           * Una sola azione qui, e non sette.
           *
           * Le altre destinazioni sono nella barra delle sezioni, presente su
           * ogni pagina del progetto: ripeterle qui le farebbe sembrare due
           * elenchi diversi. Resta l'unica che *fa* qualcosa invece di portare
           * altrove — chiedere allo Scrum Master AI di lavorare.
           */}
          <Button asChild size="sm">
            <Link href={`/progetti/${project.slug}/scrum-master`}>
              Apri lo Scrum Master AI
            </Link>
          </Button>
        </div>
      </header>

      {/*
       * Il semaforo sta in cima, e non è una preferenza di impaginazione.
       *
       * È l'unica cosa in questa pagina che riguarda ciò su cui si può ancora
       * intervenire: tutto il resto descrive com'è andata. Metterlo in fondo lo
       * trasformerebbe in una nota a piè di pagina di se stesso.
       *
       * Giudizio e spiegazione stanno nella stessa sezione perché parlano della
       * stessa cosa, e l'intestazione dichiara chi ha prodotto il numero: qui
       * misura il codice, nel riquadro sotto interpreta un modello. Sono due
       * gradi di fiducia diversi, e un lettore che non sa distinguerli finisce
       * per applicarne uno solo a tutta la pagina.
       */}
      <section aria-labelledby="salute-sprint" className="grid gap-4">
        <div className="grid gap-1">
          <h2 id="salute-sprint" className="text-lg font-medium">
            Salute dello sprint
          </h2>
          <p className="text-muted-foreground text-sm">
            Riguarda soltanto lo sprint aperto adesso. La calcola il codice ogni volta che
            si apre questa pagina, confrontando cinque segnali con altrettante soglie
            dichiarate: nessun modello linguistico partecipa al giudizio.
          </p>
        </div>

        {dashboard.health === null ? (
          /*
           * Nessuno sprint aperto: si dice, e si dice perché.
           *
           * Un semaforo verde su un progetto fermo è la peggiore delle risposte
           * — afferma che va tutto bene proprio dove non sta succedendo nulla.
           */
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nessuno sprint in corso</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              <p>
                La salute dello sprint giudica ciò che è ancora aperto, quindi qui non
                compare alcun indicatore. Non significa che il progetto stia bene o male:
                significa che in questo momento non c&apos;è uno sprint su cui intervenire.
              </p>
            </CardContent>
          </Card>
        ) : !dashboard.health.available ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Salute dello sprint non calcolabile</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              <p>
                Uno sprint risulta aperto, ma le sue date non permettono di dire quanto ne
                sia trascorso. Finché il dato non è coerente non viene proposto un giudizio:
                inventarne uno sarebbe peggio che non averlo.
              </p>
            </CardContent>
          </Card>
        ) : (
          <HealthBanner
            verdict={dashboard.health.value.verdict}
            label={VERDICT_WORDS[dashboard.health.value.verdict].label}
            summary={VERDICT_WORDS[dashboard.health.value.verdict].summary}
            elapsed={`${formatPercent(dashboard.health.value.elapsedFraction)} dello sprint trascorso`}
            signals={dashboard.health.value.signals.map((signal) => ({
              ...presentSignal(signal),
              tone: signal.status,
            }))}
          />
        )}

        {/*
         * La spiegazione sta sotto il giudizio che spiega.
         *
         * Non si genera all'apertura: la maggior parte delle visite a una
         * dashboard è un'occhiata al colore, e pagare un modello a ogni occhiata
         * sarebbe spendere per non essere letti.
         *
         * Il verdetto arriva già in parole: il riquadro lo nomina nel proprio
         * titolo, perché «chiedi una spiegazione» senza dire di che cosa è una
         * domanda a cui nessuno sa se vuole rispondere.
         */}
        {dashboard.health?.available ? (
          <HealthNarration
            slug={slug}
            enabled={dashboard.healthNarrationEnabled}
            verdictLabel={VERDICT_WORDS[dashboard.health.value.verdict].label}
            historyCount={dashboard.healthHistory.length}
          />
        ) : null}
      </section>

      {/*
       * Digest e andamento affiancati: due letture brevi, non due sezioni.
       *
       * Impilati occupavano due terzi di schermata a testa per dire poche
       * righe ciascuno, allungando la strada verso i grafici. Sono lo stesso
       * genere di contenuto — un riquadro che riassume — e stanno bene sulla
       * stessa riga.
       */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DailyDigest slug={slug} enabled={dashboard.digestEnabled} />

        {/*
         * Da quanto dura, e non solo com'è adesso.
         *
         * È l'unica cosa in questa pagina che il calcolo su richiesta non può
         * produrre: la salute si calcola quando qualcuno apre la pagina, quindi
         * senza il controllo automatico il giudizio di ieri non è mai stato
         * calcolato affatto.
         */}
        {dashboard.health === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Come è cambiato negli ultimi giorni</CardTitle>
            <CardDescription>
              Un controllo automatico al giorno conserva il giudizio, così si può vedere se
              sta peggiorando invece di sapere solo com&apos;è adesso.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {dashboard.healthHistory.length === 0 ? (
              <p className="text-muted-foreground">
                Nessun controllo automatico ancora eseguito su questo sprint. Finché non ne
                esiste almeno uno non c&apos;è una storia da mostrare: il giudizio qui sopra
                è stato calcolato adesso, aprendo la pagina.
              </p>
            ) : dashboard.healthHistory.length === 1 ? (
              /*
               * Criterio 10: con un punto solo non c'è un andamento, e
               * disegnarlo suggerirebbe una stabilità che nessuno ha osservato.
               */
              <p className="text-muted-foreground">
                Un solo controllo finora, del{" "}
                {formatDate(dashboard.healthHistory[0]?.takenAt ?? dashboard.asOf)}: non
                c&apos;è ancora un andamento da mostrare, servono almeno due giorni.
              </p>
            ) : (
              <>
                <ol className="grid gap-1">
                  {dashboard.healthHistory.map((point) => (
                    <li
                      key={point.takenAt.toISOString()}
                      className="flex flex-wrap items-baseline gap-x-3"
                    >
                      <span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">
                        {formatDate(point.takenAt)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`size-2 rounded-full ${VERDICT_DOT[point.verdict]}`}
                        />
                        {/* Il giudizio è scritto, non affidato al colore. */}
                        <span>{VERDICT_WORDS[point.verdict].label}</span>
                      </span>
                    </li>
                  ))}
                </ol>

                <p className="text-muted-foreground text-xs">
                  Un controllo al giorno. Un giorno mancante significa che il controllo non
                  è partito, non che non c&apos;era nulla da dire.
                </p>
              </>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Il flusso, nel complesso</h2>

        {/*
         * Ogni riquadro porta agli elementi che lo compongono.
         *
         * Il filtro nel collegamento corrisponde al denominatore scritto sul
         * riquadro: "su 44 elementi" apre esattamente quei 44. Se i due
         * numeri divergessero, la pagina starebbe mentendo su cosa ha contato.
         *
         * Due colonne già da 480 pixel: a una sola, le sei metriche
         * costringevano a scorrere tre schermate di telefono per vedere il
         * quadro d'insieme, che è esattamente ciò che una dashboard esiste per
         * evitare.
         */}
        <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Cycle time mediano"
            value={cycleMedian.value}
            detail={cycleMedian.detail}
            hint="Dal primo avvio alla prima chiusura."
            href={`${elementi}?conclusi=1`}
          />
          <MetricCard
            label="Cycle time all'85°"
            value={cycleP85.value}
            detail={cycleP85.detail}
            hint="La maggior parte degli elementi chiude entro questo tempo."
            href={`${elementi}?conclusi=1`}
          />
          <MetricCard
            label="Lead time mediano"
            value={leadMedian.value}
            detail={leadMedian.detail}
            hint="Dalla creazione alla chiusura: include l'attesa in backlog."
            href={`${elementi}?conclusi=1`}
          />
          <MetricCard
            label="Lavoro in corso"
            value={wipNow.value}
            detail={wipNow.detail}
            hint="Elementi presi in carico e non ancora chiusi. Esclude i bloccati."
            href={`${elementi}?stato=in_progress`}
          />
        </div>

        <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Tasso di riapertura"
            value={reopen.value}
            detail={reopen.detail}
            emphasis={
              flow.reopenRate.available && flow.reopenRate.value > 0.15 ? "warning" : "normal"
            }
            hint="Quota di elementi tornati indietro dopo essere stati chiusi."
            href={`${elementi}?conclusi=1`}
          />
          <MetricCard
            label="Efficienza di flusso mediana"
            value={efficiency.value}
            detail={efficiency.detail}
            hint="Quanto del tempo in lavorazione è stato lavoro e non coda. Nel software è normale che sia bassa."
            href={elementi}
          />
          {/*
           * Accanto all'efficienza, non altrove: l'efficienza dice che del
           * tempo si è perso, questa dice dove. Mostrare la prima senza la
           * seconda lascia il lettore con un problema e nessuna direzione.
           */}
          <MetricCard
            label="Attesa in revisione mediana"
            value={reviewWait.value}
            detail={reviewWait.detail}
            hint="Da quando un elemento entra in revisione a quando qualcuno lo sblocca."
            href={`${elementi}?stato=in_review`}
          />
        </div>
      </section>

      {current && addedNow && carriedNow && sprintCycle ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-medium">
            Sprint più recente — {current.sprint.name}
          </h2>
          {current.sprint.goal ? (
            <p className="text-muted-foreground text-sm">{current.sprint.goal}</p>
          ) : null}

          <Card>
            <CardContent className="pt-6">
              {current.burndown.available ? (
                <BurndownChart
                  title="Burndown"
                  unitLabel="punti"
                  points={current.burndown.value.points.map((point) => ({
                    at: point.at,
                    remaining: point.remaining.points ?? 0,
                  }))}
                  committed={current.burndown.value.points[0]?.ideal ?? 0}
                  totalDays={current.burndown.value.totalWorkingDays}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Burndown non disponibile: nessun dato di perimetro per questo sprint.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Lavoro aggiunto dopo l'inizio"
              value={addedNow.value}
              detail={addedNow.detail}
              emphasis={
                current.scopeChange.available && current.scopeChange.value.addedCount > 0
                  ? "warning"
                  : "normal"
              }
              /*
               * Quante di quelle aggiunte sono state interruzioni.
               *
               * «We've had three unplanned items … this is useful to remember
               * when you do the sprint retrospective» (pag. 60). Il totale da
               * solo non distingue una squadra che ha accettato altro lavoro
               * da una che è stata interrotta, e sono due conversazioni
               * diverse in retrospettiva.
               */
              hint={unplannedHint(current.scopeChange)}
              href={`${elementi}?sprint=${current.sprint.id}`}
            />
            <MetricCard
              label="Lavoro trascinato"
              value={carriedNow.value}
              detail={carriedNow.detail}
              hint="Elementi non conclusi alla chiusura."
              href={`${elementi}?sprint=${current.sprint.id}`}
            />
            <MetricCard
              label="Cycle time mediano dello sprint"
              value={sprintCycle.value}
              detail={sprintCycle.detail}
              hint="Da confrontare con gli sprint precedenti, qui sotto."
              href={`${elementi}?sprint=${current.sprint.id}&conclusi=1`}
            />
          </div>
        </section>
      ) : null}

      <section className="grid gap-4">
        <h2 className="text-lg font-medium">Come sono andati gli sprint</h2>

        {/*
         * Previsione a tutta larghezza, i tre grafici su due colonne.
         *
         * Non è simmetria: la tabella ha cinque colonne e stretta a metà
         * schermo tornerebbe a scorrere in orizzontale, mentre i grafici a
         * barre hanno un'altezza fissa e affiancati fanno risparmiare due
         * schermate di scorrimento. Il difetto segnalato era proprio questo —
         * per sapere cosa sa fare il prodotto bisognava scorrere.
         */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Previsto contro effettivo</CardTitle>
            <CardDescription>
              La previsione viene scritta all&apos;inizio dello sprint e conservata così
              com&apos;è: rifarla oggi non sarebbe ricordarla, sarebbe deciderla di nuovo con
              dati che il piano non aveva. L&apos;effettivo, invece, si ricalcola ogni volta
              dal motore — è stabile, e conservarne una copia creerebbe una seconda verità
              che può discostarsi dalla prima.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForecastTable sprints={sprints} />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Velocity</CardTitle>
              <CardDescription>
                Somma delle stime del lavoro concluso alla chiusura dello sprint, prese
                come erano quando ciascun elemento è entrato nello sprint: una stima
                corretta in corsa non cambia la velocity di uno sprint già chiuso. Le
                unità di stima non vengono mai sommate fra loro.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart bars={velocityBars} title="Velocity per sprint" unitLabel="punti" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cycle time mediano</CardTitle>
              <CardDescription>
                Quanto passa fra l&apos;avvio e la chiusura di un elemento. Se cresce di
                sprint in sprint, qualcosa nel flusso si sta ingolfando.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart bars={cycleBars} title="Cycle time mediano per sprint" />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Lavoro trascinato</CardTitle>
              <CardDescription>
                Elementi non conclusi alla chiusura. Una crescita costante indica una
                squadra che si impegna su più di quanto riesca a completare.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart bars={carryBars} title="Elementi trascinati per sprint" />
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="text-muted-foreground border-t pt-6 text-xs">
        Tutti i numeri di questa pagina sono calcolati in codice deterministico e
        testato. Nessuno è stato prodotto da un modello linguistico.{" "}
        {/*
         * L'affermazione porta a dove si può controllare. Una dichiarazione di
         * affidabilità che non si può verificare chiede fiducia, ed è proprio
         * la fiducia che rende pericoloso un numero sbagliato.
         */}
        <Link href="/metriche" className="hover:text-foreground underline underline-offset-4">
          Come si calcolano
        </Link>
        .
      </footer>
    </main>
  );
}
