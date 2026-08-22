import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import {
  organizationIdSchema,
  workItemStateSchema,
  type WorkItemState,
} from "@/domain";
import { auth } from "@/lib/auth";
import { formatDuration, formatEstimate, formatNumber } from "@/lib/format";
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

const STATE_LABELS: Readonly<Record<WorkItemState, string>> = {
  todo: "Da fare",
  in_progress: "In lavorazione",
  in_review: "In revisione",
  blocked: "Bloccato",
  done: "Concluso",
  cancelled: "Annullato",
};

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
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors",
        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
      )}
    >
      {label}
    </Link>
  );

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <header className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/progetti" className="underline underline-offset-4">
            Progetti
          </Link>
          {" · "}
          <Link href={`/progetti/${project.slug}`} className="underline underline-offset-4">
            {project.name}
          </Link>
        </p>

        <h1 className="text-2xl font-semibold tracking-tight">Elementi</h1>

        <p className="text-muted-foreground text-sm">
          {rows.length === totalCount
            ? `${formatNumber(totalCount)} elementi`
            : `${formatNumber(rows.length)} elementi su ${formatNumber(totalCount)}`}
          {" · ordinati per cycle time decrescente"}
        </p>
      </header>

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
                <div className="flex items-baseline justify-between gap-4">
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

      <p className="text-muted-foreground text-sm">
        <Link
          href={`/progetti/${project.slug}`}
          className="underline underline-offset-4"
        >
          Torna alla dashboard
        </Link>
      </p>
    </main>
  );
}
