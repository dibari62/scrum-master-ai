import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { MetricCard } from "@/components/charts/metric-card";
import { Timeline, type TimelineEntry } from "@/components/charts/timeline";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import {
  organizationIdSchema,
  workItemIdSchema,
  type WorkItemKind,
  type WorkItemState,
} from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatDuration, formatEstimate, formatNumber } from "@/lib/format";
import { STATE_LABELS as SHARED_STATE_LABELS } from "@/lib/state-words";

import { presentDuration, presentPercent } from "../../../present";
import { loadWorkItemDetail } from "./data";

export const dynamic = "force-dynamic";

type PageProps = {
  readonly params: Promise<{ readonly slug: string; readonly id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Elemento · ${slug} · Scrum Master AI` };
}

/** The Italian words for the canonical states (`docs/domain-glossary.md`). */
const STATE_LABELS = SHARED_STATE_LABELS;

const KIND_LABELS: Readonly<Record<WorkItemKind, string>> = {
  story: "Storia",
  bug: "Difetto",
  task: "Attività",
  epic: "Epica",
  spike: "Indagine",
};

/**
 * How the metrics read a span.
 *
 * The mapping is here, not in the component, because it *is* a statement about
 * the metrics — `in_review` counts as waiting rather than work, which is the
 * decision taken on open question Q1 of the glossary. Putting it in a
 * presentational component would hide a domain decision inside a colour.
 */
const NATURE: Readonly<Record<WorkItemState, TimelineEntry["nature"]>> = {
  todo: "idle",
  in_progress: "work",
  in_review: "queue",
  blocked: "blocked",
  done: "done",
  cancelled: "done",
};

export default async function WorkItemPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug, id } = await params;

  // A malformed identifier is a wrong address, not a server error: parsing here
  // turns it into the same "not found" as an item belonging to someone else.
  const parsed = workItemIdSchema.safeParse(id);
  if (!parsed.success) notFound();

  const detail = await loadWorkItemDetail(
    organizationIdSchema.parse(session.organizationId),
    slug,
    parsed.data,
    new Date(),
  );

  if (!detail) notFound();

  const { project, item, sprint, assignee, intervals, transitions } = detail;

  const actorNames = new Map<string, string>();
  if (assignee) actorNames.set(assignee.id, assignee.displayName);

  const entries: readonly TimelineEntry[] = intervals.map((interval, index) => ({
    label: STATE_LABELS[interval.state],
    enteredAt: interval.from,
    leftAt: interval.to,
    duration: interval.duration,
    nature: NATURE[interval.state],
    actor: actorNames.get(transitions[index]?.actorId ?? ""),
  }));

  const cycle = presentDuration(detail.cycleTime);
  const lead = presentDuration(detail.leadTime);
  const efficiency = presentPercent(detail.flowEfficiency, 0);
  const review = presentDuration(detail.reviewWait);
  const aging = presentDuration(detail.aging);

  const transitionsLabel = `su ${formatNumber(transitions.length)} transizioni`;

  return (
    <main className="app-shell grid gap-8 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Elementi", href: `/progetti/${project.slug}/elementi` },
            { label: item.title },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>

        <p className="text-muted-foreground text-sm">
          {KIND_LABELS[item.kind]} · {STATE_LABELS[item.state]}
          {sprint ? ` · ${sprint.name}` : " · nessuno sprint"}
          {item.estimate
            ? ` · ${formatEstimate(item.estimate.value, item.estimate.unit)}`
            : " · senza stima"}
        </p>
      </header>

      {item.description ? (
        <Card>
          <CardContent className="pt-6">
            {/*
             * Rendered as plain text, never as markup.
             *
             * The description comes from an external source and is data, never
             * instruction (§8.1). React escapes it, which is exactly what is
             * wanted here: no `dangerouslySetInnerHTML`, ever, on ingested text.
             */}
            <p className="text-sm whitespace-pre-wrap">{item.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">I numeri di questo elemento</h2>

        <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Cycle time"
            value={cycle.value}
            detail={cycle.detail}
            hint="Dal primo avvio alla prima chiusura."
          />
          <MetricCard
            label="Lead time"
            value={lead.value}
            detail={lead.detail}
            hint="Dalla creazione alla prima chiusura: include l'attesa in backlog."
          />
          <MetricCard
            label="Efficienza di flusso"
            value={efficiency.value}
            detail={efficiency.detail}
            hint="Quota del cycle time passata in lavorazione, non in coda."
          />
          <MetricCard
            label="Attesa in revisione"
            value={review.value}
            detail={review.detail}
            hint="Ultima permanenza in revisione."
          />
          <MetricCard
            label="Tempo bloccato"
            value={detail.blocked > 0 ? formatDuration(detail.blocked) : "nessuno"}
            detail={transitionsLabel}
            emphasis={detail.blocked > 0 ? "warning" : "normal"}
            hint="Tempo cumulato in stato bloccato."
          />
          <MetricCard
            label="Riaperture"
            value={formatNumber(detail.reopenings)}
            detail={transitionsLabel}
            emphasis={detail.reopenings > 0 ? "warning" : "normal"}
            hint="Quante volte è tornato indietro dopo essere stato concluso."
          />
        </div>

        {detail.aging.available ? (
          <p className="text-muted-foreground text-sm">
            Fermo nello stato attuale da <strong>{aging.value}</strong>.
          </p>
        ) : null}
      </section>

      <section className="grid gap-3">
        {/*
         * Un titolo vero, non un testo che sembra un titolo.
         *
         * Prima era un `CardTitle`, che rende un `div`: visivamente identico,
         * ma invisibile a chi naviga per intestazioni con un lettore di
         * schermo. L'ha trovato il test end-to-end cercando l'intestazione e
         * non trovandola.
         */}
        <h2 className="text-lg font-medium">Storia degli stati</h2>

        <Card>
          <CardContent className="grid gap-4 pt-6">
            <p className="text-muted-foreground text-sm">
              Da qui escono tutti i numeri qui sopra. Il cycle time è la distanza fra la
              prima entrata in lavorazione e la prima conclusione; l&apos;efficienza di
              flusso è la quota di quel tempo passata in lavorazione. Sommando le durate
              si ottengono gli stessi valori, a mano.
            </p>

            <Timeline entries={entries} />
          </CardContent>
        </Card>
      </section>

      <p className="text-muted-foreground text-xs">
        Dati al {formatDate(detail.asOf)}. Tutti i numeri di questa pagina sono calcolati
        in codice deterministico e testato.
      </p>
    </main>
  );
}
