import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/charts/data-table";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import {
  ESTIMATION_SCALE_LABELS,
  organizationIdSchema,
  workItemStateSchema,
} from "@/domain";
import { auth } from "@/lib/auth";
import { formatDuration, formatEstimate, formatNumber } from "@/lib/format";
import { STATE_LABELS as SHARED_STATE_LABELS } from "@/lib/state-words";

import { ProjectQuestion } from "./project-question";
import { cn } from "@/lib/utils";

import { loadWorkItems, type WorkItemFilter } from "./data";

export const dynamic = "force-dynamic";

type PageProps = {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Elementi · ${slug} · Scrum Master AI` };
}

const STATE_LABELS = SHARED_STATE_LABELS;

/** Reads one query-string value, ignoring a repeated parameter. */
function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function WorkItemsPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const query = await searchParams;

  /*
   * The query string is input from outside, so it is parsed rather than cast.
   * An unknown state becomes "no filter" instead of an error: a mistyped
   * address should show the list, not a stack trace.
   */
  const stateParam = single(query["stato"]);
  const parsedState = stateParam ? workItemStateSchema.safeParse(stateParam) : null;

  const filter: WorkItemFilter = {
    state: parsedState?.success ? parsedState.data : null,
    sprintId: single(query["sprint"]),
    completedOnly: single(query["conclusi"]) === "1",
  };

  const list = await loadWorkItems(
    organizationIdSchema.parse(session.organizationId),
    slug,
    filter,
  );

  if (!list) notFound();

  const { project, rows, sprints, totalCount, scaleConformance } = list;

  const linkFor = (next: Partial<WorkItemFilter>): string => {
    const merged = { ...filter, ...next };
    const search = new URLSearchParams();
    if (merged.state) search.set("stato", merged.state);
    if (merged.sprintId) search.set("sprint", merged.sprintId);
    if (merged.completedOnly) search.set("conclusi", "1");

    const suffix = search.toString();
    return `/progetti/${project.slug}/elementi${suffix ? `?${suffix}` : ""}`;
  };

  const filterLink = (label: string, href: string, active: boolean) => (
    <Link
      key={`${label}-${href}`}
      href={href}
      /*
       * `min-h-9` e `px-3`: il bersaglio di tocco.
       *
       * A `py-1` questi filtri erano alti diciotto pixel — sotto i
       * quarantaquattro che le linee guida di Apple e Google indicano come
       * minimo, e affiancati abbastanza da far sbagliare il dito. Su
       * scrivania non cambia nulla; su telefono è la differenza fra usarli e
       * combatterli.
       */
      className={cn(
        "inline-flex min-h-9 items-center rounded-md border px-3 text-xs transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
      )}
      aria-current={active ? "true" : undefined}
    >
      {label}
    </Link>
  );

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Elementi" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight">Elementi</h1>

        <p className="text-muted-foreground text-sm">
          {rows.length === totalCount
            ? `${formatNumber(totalCount)} elementi`
            : `${formatNumber(rows.length)} elementi su ${formatNumber(totalCount)}`}
          {" · ordinati per cycle time decrescente"}
        </p>
      </header>

      {/*
       * La domanda sta dove stanno le fonti.
       *
       * La risposta cita elementi di questa pagina: metterla altrove
       * costringerebbe a fidarsi dei titoli citati invece di poterli aprire
       * subito sopra.
       */}
      <ProjectQuestion slug={project.slug} enabled={list.questionEnabled} />

      <div className="grid gap-2">
        <div className="flex flex-wrap gap-1.5">
          {filterLink("Tutti", linkFor({ state: null, completedOnly: false }), !filter.state && !filter.completedOnly)}
          {filterLink("Conclusi", linkFor({ state: null, completedOnly: true }), filter.completedOnly)}
          {workItemStateSchema.options.map((state) =>
            filterLink(
              STATE_LABELS[state],
              linkFor({ state, completedOnly: false }),
              filter.state === state,
            ),
          )}
        </div>

        {sprints.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {filterLink("Tutti gli sprint", linkFor({ sprintId: null }), !filter.sprintId)}
            {sprints.map((sprint) =>
              filterLink(
                sprint.name.replace(/^Sprint \d+ — /, ""),
                linkFor({ sprintId: sprint.id }),
                filter.sprintId === sprint.id,
              ),
            )}
          </div>
        ) : null}
      </div>

      {scaleConformance.scale === "free" ? null : (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="grid gap-1">
              <h2 className="text-base font-semibold">
                Scala di stima · {ESTIMATION_SCALE_LABELS[scaleConformance.scale]}
              </h2>
              <p className="text-muted-foreground text-sm">
                {scaleConformance.offScale.length === 0
                  ? `Tutte le ${formatNumber(scaleConformance.considered)} stime in punti stanno sulla scala dichiarata.`
                  : `${formatNumber(scaleConformance.offScale.length)} stime su ${formatNumber(scaleConformance.considered)} non stanno sulla scala dichiarata.`}
              </p>
            </div>

            {scaleConformance.offScale.length > 0 ? (
              <>
                <DataTable
                  caption="Stime che non compaiono fra i valori ammessi dalla scala"
                  rows={scaleConformance.offScale}
                  getKey={(deviation) => deviation.itemId}
                  getHref={(deviation) =>
                    `/progetti/${project.slug}/elementi/${deviation.itemId}`
                  }
                  minWidth="min-w-[34rem]"
                  rowAttribute="data-off-scale"
                  columns={[
                    {
                      key: "elemento",
                      header: "Elemento",
                      className: "min-w-[18rem]",
                      cell: (deviation) => (
                        <span className="font-medium">{deviation.title}</span>
                      ),
                    },
                    {
                      key: "stima",
                      header: "Stima",
                      align: "end",
                      cell: (deviation) => formatEstimate(deviation.value, "points"),
                    },
                    {
                      key: "ammessi",
                      header: "Valori ammessi vicini",
                      align: "end",
                      className: "min-w-[12rem]",
                      cell: (deviation) =>
                        deviation.neighbours ? (
                          `${formatNumber(deviation.neighbours.below)} o ${formatNumber(deviation.neighbours.above)}`
                        ) : (
                          // Sopra la carta più grande non c'è un valore
                          // superiore da nominare, e inventarne uno sarebbe
                          // peggio che tacere.
                          <span className="text-muted-foreground">nessuno sopra</span>
                        ),
                    },
                  ]}
                />

                <p className="text-muted-foreground text-xs">
                  Il portale <strong>segnala, non corregge</strong>: le stime arrivano da una
                  fonte esterna, e rifiutarle farebbe perdere l&apos;elemento invece della
                  stima. I salti della scala sono voluti — «you can&apos;t cheat by combining
                  a 5 and a 2 to make a 7&nbsp;… there is no 7».
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            Nessun elemento corrisponde a questo filtro.
          </CardContent>
        </Card>
      ) : (
        <DataTable
          caption="Elementi del progetto, con stato, sprint, stima e cycle time"
          rows={rows}
          getKey={(row) => row.item.id}
          getHref={(row) => `/progetti/${project.slug}/elementi/${row.item.id}`}
          /*
           * L'elenco degli elementi si sa nominare.
           *
           * Da quando su questa pagina può comparire anche la tabella delle
           * stime fuori scala, «le righe di una tabella dentro main» non
           * identifica più una cosa sola: contarle tutte insieme sommerebbe due
           * elenchi diversi, che è esattamente l'errore che un test sul
           * denominatore esiste per impedire.
           */
          rowAttribute="data-item"
          columns={[
            {
              key: "titolo",
              header: "Elemento",
              className: "min-w-[18rem]",
              cell: (row) => <span className="font-medium">{row.item.title}</span>,
            },
            {
              key: "stato",
              header: "Stato",
              className: "min-w-[8rem]",
              cell: (row) => STATE_LABELS[row.item.state],
            },
            {
              key: "sprint",
              header: "Sprint",
              className: "min-w-[10rem]",
              cell: (row) => (
                <span className={row.sprintName ? undefined : "text-muted-foreground"}>
                  {row.sprintName ?? "nessuno"}
                </span>
              ),
            },
            {
              key: "stima",
              header: "Stima",
              align: "end",
              cell: (row) =>
                row.item.estimate ? (
                  formatEstimate(row.item.estimate.value, row.item.estimate.unit)
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              key: "cycle",
              header: "Cycle time",
              align: "end",
              cell: (row) =>
                row.cycleTime.available ? (
                  formatDuration(row.cycleTime.value)
                ) : (
                  // «Non concluso» e non un trattino: qui l'assenza ha una
                  // ragione precisa, e dirla vale più che lasciarla indovinare.
                  <span className="text-muted-foreground">non concluso</span>
                ),
            },
            {
              key: "transizioni",
              header: "Transizioni",
              align: "end",
              cell: (row) => formatNumber(row.transitionCount),
            },
          ]}
        />
      )}
    </main>
  );
}
