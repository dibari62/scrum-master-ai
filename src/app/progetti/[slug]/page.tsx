import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BarChart, type Bar } from "@/components/charts/bar-chart";
import { BurndownChart } from "@/components/charts/burndown-chart";
import { MetricCard } from "@/components/charts/metric-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatDuration, formatNumber } from "@/lib/format";
import { available } from "@/metrics";

import { loadProjectDashboard, type SprintMetrics } from "../data";
import {
  presentCount,
  presentDuration,
  presentEstimates,
  presentPercent,
} from "../present";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} · Scrum Master AI` };
}

function sprintLabel(entry: SprintMetrics): string {
  return entry.sprint.name.replace(/^Sprint \d+ — /, "");
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
    <main className="mx-auto grid max-w-4xl gap-8 px-6 py-12">
      <header className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/progetti" className="underline underline-offset-4">
            Progetti
          </Link>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
        <p className="text-muted-foreground text-sm">
          {formatNumber(sprints.length)} sprint · {formatNumber(dashboard.peopleCount)}{" "}
          persone · dati al {formatDate(dashboard.asOf)} ·{" "}
          <Link href={elementi} className="underline underline-offset-4">
            vedi gli elementi
          </Link>
        </p>
      </header>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Il flusso, nel complesso</h2>

        {/*
         * Ogni riquadro porta agli elementi che lo compongono.
         *
         * Il filtro nel collegamento corrisponde al denominatore scritto sul
         * riquadro: "su 44 elementi" apre esattamente quei 44. Se i due
         * numeri divergessero, la pagina starebbe mentendo su cosa ha contato.
         */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="grid gap-3 sm:grid-cols-3">
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
                  points={current.burndown.value.map((point) => ({
                    at: point.at,
                    remaining: point.remaining.points ?? 0,
                  }))}
                  committed={current.burndown.value[0]?.remaining.points ?? 0}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Burndown non disponibile: nessun dato di perimetro per questo sprint.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Lavoro aggiunto dopo l'inizio"
              value={addedNow.value}
              detail={addedNow.detail}
              emphasis={
                current.scopeChange.available && current.scopeChange.value.addedCount > 0
                  ? "warning"
                  : "normal"
              }
              hint="Elementi entrati a sprint iniziato."
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

      <section className="grid gap-6">
        <h2 className="text-lg font-medium">Come sono andati gli sprint</h2>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Velocity</CardTitle>
            <CardDescription>
              Somma delle stime del lavoro concluso alla chiusura dello sprint. Le unità
              di stima non vengono mai sommate fra loro.
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

        <Card>
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
      </section>

      <footer className="text-muted-foreground border-t pt-6 text-xs">
        Tutti i numeri di questa pagina sono calcolati in codice deterministico e
        testato. Nessuno è stato prodotto da un modello linguistico.
      </footer>
    </main>
  );
}
