import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/charts/data-table";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { organizationIdSchema, scrumEventSchema, type ScrumEvent } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatEstimate, formatNumber } from "@/lib/format";
import { CHECKLIST_STATUS_LABELS, type DemoAgendaEntry } from "@/metrics";
import { STATE_LABELS } from "@/lib/state-words";

import { loadSprintInfo, type SprintInfo } from "./data";

export const dynamic = "force-dynamic";

type PageProps = {
  readonly params: Promise<{ readonly slug: string; readonly id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Sprint · ${slug} · Scrum Master AI` };
}

const CEREMONY_LABELS: Readonly<Record<ScrumEvent, string>> = {
  sprint_planning: "Pianificazione",
  daily_scrum: "Daily scrum",
  sprint_review: "Demo",
  sprint_retrospective: "Retrospettiva",
  backlog_refinement: "Affinamento del backlog",
};

const DAY_LABELS: Readonly<Record<string, string>> = {
  monday: "lunedì",
  tuesday: "martedì",
  wednesday: "mercoledì",
  thursday: "giovedì",
  friday: "venerdì",
  saturday: "sabato",
  sunday: "domenica",
};

/**
 * La pagina informativa dello sprint (cap. 5).
 *
 * > «It is important to keep the whole company informed about what is going on.
 * > Otherwise, people will complain or, even worse, **make false assumptions**
 * > about what is going on.» (pag. 52)
 *
 * Nel libro la scrive lo Scrum Master a mano dopo la pianificazione. Qui è
 * **generata**, ed è l'unica cosa in cui questa versione batte quella di carta:
 * una pagina scritta una volta descrive lo sprint com'era alla riunione, e uno
 * sprint che si muove la rende silenziosamente falsa. Questa non può invecchiare.
 */
export default async function SprintInfoPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug, id } = await params;

  const info = await loadSprintInfo(
    organizationIdSchema.parse(session.organizationId),
    slug,
    id,
    new Date(),
  );

  if (!info) notFound();

  const { project, sprint, items, total, ceremonies, describedCount, demo, demoChecks } = info;

  const scheduled = scrumEventSchema.options
    .map((event) => ({ event, slot: ceremonies[event] }))
    .filter((entry) => entry.slot !== null && entry.slot !== undefined);

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Sprint", href: `/progetti/${project.slug}/sprint` },
            { label: sprint.name },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{sprint.name}</h1>

        {/*
         * L'obiettivo per primo e in grande.
         *
         * È la sola riga che risponde alla domanda per cui la pagina esiste —
         * «che cosa sta facendo quella squadra» — e chi passa davanti a un
         * foglio appeso al muro legge quella e basta.
         */}
        <p className={sprint.goal === null ? "text-muted-foreground text-lg" : "text-lg"}>
          {sprint.goal ?? "Nessun obiettivo dichiarato per questo sprint."}
        </p>
      </header>

      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm">
          <p className="tabular-nums">
            Dal <strong>{formatDate(sprint.startsAt)}</strong> al{" "}
            <strong>{formatDate(sprint.endsAt)}</strong>
            {sprint.completedAt ? ` · chiuso il ${formatDate(sprint.completedAt)}` : ""}
          </p>

          <p className="tabular-nums">
            {formatNumber(items.length)} elementi
            {total.points === null ? "" : ` · ${formatEstimate(total.points, "points")}`}
            {total.hours === null ? "" : ` · ${formatEstimate(total.hours, "hours")}`}
          </p>

          {scheduled.length > 0 ? (
            <p className="text-muted-foreground">
              {scheduled
                .map(
                  (entry) =>
                    `${CEREMONY_LABELS[entry.event]}: ${DAY_LABELS[entry.slot?.dayOfWeek ?? ""] ?? ""} ${entry.slot?.timeOfDay ?? ""}`,
                )
                .join(" · ")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Nessuna cerimonia pianificata nel contesto di progetto.
            </p>
          )}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            Nessun elemento risulta in questo sprint.
          </CardContent>
        </Card>
      ) : (
        <>
          <DataTable
            caption="Che cosa contiene questo sprint, e come si dimostra"
            rows={items}
            getKey={(item) => item.id}
            getHref={(item) => `/progetti/${project.slug}/elementi/${item.id}`}
            rowAttribute="data-sprint-item"
            minWidth="min-w-[46rem]"
            columns={[
              {
                key: "titolo",
                header: "Elemento",
                className: "min-w-[18rem]",
                cell: (item) => <span className="font-medium">{item.title}</span>,
              },
              {
                key: "stato",
                header: "Stato",
                className: "min-w-[8rem]",
                cell: (item) => STATE_LABELS[item.state],
              },
              {
                key: "stima",
                header: "Stima",
                align: "end",
                cell: (item) =>
                  item.estimate ? (
                    formatEstimate(item.estimate.value, item.estimate.unit)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                key: "demo",
                header: "Come si dimostra",
                className: "min-w-[22rem]",
                cell: (item) =>
                  item.howToDemo ?? <span className="text-muted-foreground">da definire</span>,
              },
            ]}
          />

          {/*
           * Quanto è compilata la colonna della demo si dice, non si lascia
           * dedurre contando le righe.
           *
           * Il libro la elenca come parte facoltativa — «*sometimes* we include
           * info about how each story will be demonstrated» — quindi la sua
           * assenza non è un difetto, e dichiarare quanto è piena è più utile
           * sia che nasconderla sia che lamentarsene.
           */}
          <p className="text-muted-foreground text-xs">
            {formatNumber(describedCount)} elementi su {formatNumber(items.length)} dichiarano
            come si dimostrano. Il libro la elenca come parte facoltativa della pagina, non
            come un obbligo.
          </p>
        </>
      )}

      <DemoAgendaSection slug={project.slug} demo={demo} checks={demoChecks} />

      <p className="text-muted-foreground text-xs">
        Questa pagina è <strong>generata dai dati</strong>. Nel libro la scrive a mano lo
        Scrum Master dopo la pianificazione e la appende al muro — ed è l&apos;unica cosa in
        cui questa versione fa meglio di quella di carta: una pagina scritta una volta
        descrive lo sprint com&apos;era quel giorno, e uno sprint che si muove la rende
        silenziosamente falsa. Questa non può invecchiare.
      </p>
    </main>
  );
}

const KIND_LABELS: Readonly<Record<DemoAgendaEntry["kind"], string>> = {
  story: "storia",
  epic: "epica",
  bug: "difetto",
  task: "task",
  spike: "spike",
};

const DEMO_COLUMNS = [
  {
    key: "titolo",
    header: "Elemento",
    className: "min-w-[18rem]",
    cell: (entry: DemoAgendaEntry) => <span className="font-medium">{entry.title}</span>,
  },
  {
    key: "tipo",
    header: "Tipo",
    className: "min-w-[7rem]",
    cell: (entry: DemoAgendaEntry) => KIND_LABELS[entry.kind],
  },
  {
    key: "demo",
    header: "Come si dimostra",
    className: "min-w-[22rem]",
    cell: (entry: DemoAgendaEntry) =>
      entry.howToDemo ?? <span className="text-muted-foreground">da definire</span>,
  },
];

/**
 * La scaletta della demo (cap. 9).
 *
 * Due elenchi e non uno, perché il libro dà due comportamenti diversi: le storie
 * si mostrano, le correzioni minori si nominano. Un unico elenco ordinato
 * lascerebbe a chi conduce la demo la decisione che il libro dice di prendere
 * prima di entrare in sala.
 */
function DemoAgendaSection({
  slug,
  demo,
  checks,
}: {
  readonly slug: string;
  readonly demo: SprintInfo["demo"];
  readonly checks: SprintInfo["demoChecks"];
}) {
  return (
    <Card data-demo-agenda>
      <CardHeader>
        <CardTitle>Scaletta della demo</CardTitle>
      </CardHeader>

      <CardContent className="grid gap-4">
        {demo.toDemo.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-demo-empty>
            Nessun elemento finito da mostrare in questo sprint.
          </p>
        ) : (
          <DataTable
            caption="Da mostrare, in ordine di backlog"
            rows={demo.toDemo}
            getKey={(entry) => entry.itemId}
            getHref={(entry) => `/progetti/${slug}/elementi/${entry.itemId}`}
            rowAttribute="data-demo-show"
            minWidth="min-w-[46rem]"
            columns={DEMO_COLUMNS}
          />
        )}

        {demo.toMention.length > 0 ? (
          <DataTable
            caption="Da nominare soltanto: correzioni, task e spike"
            rows={demo.toMention}
            getKey={(entry) => entry.itemId}
            getHref={(entry) => `/progetti/${slug}/elementi/${entry.itemId}`}
            rowAttribute="data-demo-mention"
            minWidth="min-w-[46rem]"
            columns={DEMO_COLUMNS}
          />
        ) : null}

        <ul className="grid gap-1 border-t pt-3">
          {checks.map((entry) => (
            <li key={entry.id} data-demo-check={entry.status} className="text-sm">
              <span className={entry.status === "todo" ? "font-medium" : "text-muted-foreground"}>
                {entry.text}
              </span>{" "}
              <span className="text-muted-foreground text-xs">
                — {CHECKLIST_STATUS_LABELS[entry.status]}: {entry.detail}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs">
          La divisione fra ciò che si mostra e ciò che si nomina viene dal libro:{" "}
          <em>
            «Don&apos;t demonstrate a bunch of minor bug fixes and trivial features. Mention
            them but don&apos;t demo them, since that generally takes too long and detracts
            focus from the more important stories.»
          </em>{" "}
          In scaletta entra ciò che risultava finito alla chiusura dello sprint: la stessa
          cosa che conta la velocity, o i due numeri racconterebbero sprint diversi.
        </p>
      </CardContent>
    </Card>
  );
}
