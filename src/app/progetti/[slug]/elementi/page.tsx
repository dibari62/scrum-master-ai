import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import {
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

  const { project, rows, sprints, totalCount } = list;

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

      {rows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            Nessun elemento corrisponde a questo filtro.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.item.id}>
              <Link
                href={`/progetti/${project.slug}/elementi/${row.item.id}`}
                className="hover:border-foreground/30 block rounded-lg border p-3 transition-colors"
              >
                {/*
                 * Il titolo va a capo, la durata resta su una riga sua.
                 *
                 * Affiancati con `justify-between`, un titolo lungo su schermo
                 * stretto spingeva la durata fuori vista o la schiacciava
                 * contro il bordo. Il tempo è il motivo per cui si apre questo
                 * elenco: è l'ultima cosa che può cedere.
                 */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="text-sm font-medium">{row.item.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {row.cycleTime.available
                      ? formatDuration(row.cycleTime.value)
                      : "non concluso"}
                  </span>
                </div>

                <p className="text-muted-foreground mt-1 text-xs">
                  {STATE_LABELS[row.item.state]}
                  {row.sprintName ? ` · ${row.sprintName}` : ""}
                  {row.item.estimate
                    ? ` · ${formatEstimate(row.item.estimate.value, row.item.estimate.unit)}`
                    : " · senza stima"}
                  {` · ${formatNumber(row.transitionCount)} transizioni`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
