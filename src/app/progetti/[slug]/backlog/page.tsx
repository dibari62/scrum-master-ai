import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/charts/data-table";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { formatEstimate, formatNumber } from "@/lib/format";
import { STATE_LABELS } from "@/lib/state-words";

import { loadBacklog } from "./data";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Backlog · ${slug} · Scrum Master AI` };
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  story: "Storia",
  bug: "Difetto",
  task: "Attività",
  epic: "Epica",
  spike: "Indagine",
};

export default async function BacklogPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;

  const list = await loadBacklog(organizationIdSchema.parse(session.organizationId), slug);
  if (!list) notFound();

  const { project, items, total, unplacedCount, describedCount } = list;

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Backlog" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Backlog di prodotto
        </h1>

        <p className="text-muted-foreground text-sm">
          Ciò che non è ancora entrato in uno sprint, <strong>nell&apos;ordine in cui
          verrà preso</strong>.
        </p>
      </header>

      {items.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground grid gap-3 pt-6 text-sm">
            <p>
              Il backlog è vuoto: ogni elemento del progetto è già in uno sprint oppure è
              concluso.
            </p>
            <p>
              Gli elementi arrivano dalle fonti collegate. Per popolare il progetto con una
              storia sintetica esegui <code className="font-mono text-xs">npm run seed</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-2 pt-6 text-sm">
              <p className="tabular-nums">
                {formatNumber(items.length)} elementi
                {total.points === null
                  ? ""
                  : ` · ${formatEstimate(total.points, "points")} in totale`}
                {total.hours === null ? "" : ` · ${formatEstimate(total.hours, "hours")}`}
              </p>

              {/*
               * Ciò che manca si dice, non si lascia scoprire.
               *
               * «How to demo is filled in for all high-importance items»: il
               * libro affina la cima della lista e lascia grezza la coda, ed è
               * normale. Ma quanto sia affinata è un fatto sulla squadra, e
               * tacerlo lo farebbe sparire in silenzio.
               */}
              <p className="text-muted-foreground">
                {formatNumber(describedCount)} su {formatNumber(items.length)} dichiarano{" "}
                <strong>come si dimostrano</strong>. Il libro chiede di riempirlo per gli
                elementi in cima, non per tutti: è la coda che resta grezza, non un difetto.
              </p>

              {unplacedCount > 0 ? (
                <p className="text-muted-foreground">
                  {formatNumber(unplacedCount)} non hanno ancora una posizione e stanno in
                  fondo. <strong>Senza posizione non è «meno importante»</strong>: è che
                  nessuno li ha ancora collocati.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <DataTable
            caption="Backlog di prodotto, nell'ordine deciso dal Product Owner"
            rows={items}
            getKey={(item) => item.id}
            getHref={(item) => `/progetti/${project.slug}/elementi/${item.id}`}
            rowAttribute="data-backlog-item"
            minWidth="min-w-[52rem]"
            columns={[
              {
                key: "posizione",
                header: "#",
                align: "end",
                cell: (item) =>
                  item.backlogOrder === null ? (
                    // Un trattino, non uno zero: zero è una posizione, e la
                    // prima per giunta.
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatNumber(item.backlogOrder + 1)
                  ),
              },
              {
                key: "titolo",
                header: "Elemento",
                className: "min-w-[18rem]",
                cell: (item) => <span className="font-medium">{item.title}</span>,
              },
              {
                key: "tipo",
                header: "Tipo",
                className: "min-w-[7rem]",
                cell: (item) => KIND_LABELS[item.kind] ?? item.kind,
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
                    <span className="text-muted-foreground">non stimata</span>
                  ),
              },
              {
                key: "demo",
                header: "Come si dimostra",
                className: "min-w-[24rem]",
                cell: (item) =>
                  item.howToDemo ?? (
                    // «Da definire» e non un trattino: qui l'assenza è una
                    // cosa da fare, non un dato che non esiste.
                    <span className="text-muted-foreground">da definire</span>
                  ),
              },
            ]}
          />

          <p className="text-muted-foreground text-xs">
            L&apos;ordine è una <strong>posizione, non un punteggio</strong>. Il libro usava
            una colonna <em>Importance</em> numerica e l&apos;autore la ritratta nella
            seconda edizione: «there&apos;s no importance column. Instead, I just order the
            list». Un punteggio invita a fare aritmetica su di esso, e due elementi con lo
            stesso numero lasciano senza risposta la sola domanda che serve alla
            pianificazione — quale viene prima.
          </p>
        </>
      )}
    </main>
  );
}
