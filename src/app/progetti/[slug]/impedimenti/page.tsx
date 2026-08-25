import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatDuration, formatNumber } from "@/lib/format";

import { loadProjectImpediments } from "./data";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Impedimenti · ${slug} · Scrum Master AI` };
}

export default async function ProjectImpedimentsPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const asOf = new Date();

  const register = await loadProjectImpediments(
    organizationIdSchema.parse(session.organizationId),
    slug,
    asOf,
  );

  if (!register) notFound();

  const { project, entries, openCount } = register;
  const resolvedCount = entries.length - openCount;

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Impedimenti" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Impedimenti</h1>

        <p className="text-muted-foreground text-sm">
          {entries.length === 0
            ? "Nessun impedimento registrato"
            : `${formatNumber(entries.length)} registrati · ${openCount === 0 ? "nessuno ancora aperto" : openCount === 1 ? "1 ancora aperto" : `${formatNumber(openCount)} ancora aperti`} · situazione al ${formatDate(register.asOf)}`}
        </p>
      </header>

      {/*
       * La distinzione che rende leggibile tutto il resto.
       *
       * «Impedimento» ed «elemento bloccato» sembrano la stessa cosa e non lo
       * sono. Chi non legge questa spiegazione conta gli ostacoli guardando la
       * colonna «Bloccato» della bacheca e ottiene un numero più grande, poi
       * conclude che una delle due schermate sbaglia.
       */}
      <aside aria-labelledby="non-e-un-elemento-bloccato">
        <Card className="bg-muted/40">
          <CardHeader>
            <h2
              id="non-e-un-elemento-bloccato"
              className="text-base leading-none font-semibold"
            >
              Un impedimento non è un elemento bloccato
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              L&apos;<strong>ostacolo</strong> è uno: «il fornitore di pagamenti non
              risponde». Gli <strong>elementi</strong> fermi per causa sua possono essere
              quattro. Sono due conteggi diversi, e per questo il modello li tiene
              separati.
            </p>
            <p>
              Contare gli elementi bloccati riporterebbe quattro volte lo stesso ostacolo;
              contare solo gli ostacoli nasconderebbe quanto lavoro hanno toccato. Qui si
              contano gli ostacoli; gli elementi fermi si vedono{" "}
              <Link
                href={`/progetti/${project.slug}/elementi?stato=blocked`}
                className="hover:text-foreground underline underline-offset-4"
              >
                nell&apos;elenco degli elementi
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </aside>

      {entries.length === 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-base leading-none font-semibold">
              Nessun impedimento nei dati
            </h2>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-3 text-sm">
            <p>
              Gli impedimenti arrivano dalle fonti collegate, come tutto il resto: non si
              inseriscono da questa pagina.
            </p>
            <p>
              Un elenco vuoto non significa che il team non abbia incontrato ostacoli.
              Significa che nessuna fonte collegata ne ha registrato uno — che è una
              affermazione più debole, e vale la pena tenerle distinte.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-3">
          <h2 className="text-lg font-medium">
            Registro {resolvedCount > 0 ? "— dal più recente" : ""}
          </h2>

          <ul className="grid gap-2">
            {entries.map((entry) => (
              <li key={entry.impediment.id} className="rounded-lg border p-3">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="text-sm font-medium">{entry.impediment.title}</span>
                  <span
                    className={`shrink-0 text-xs ${entry.open ? "text-destructive font-medium" : "text-muted-foreground"}`}
                  >
                    {entry.open ? "ancora aperto" : "risolto"}
                  </span>
                </div>

                <p className="text-muted-foreground mt-1 text-xs">
                  Sollevato il {formatDate(entry.impediment.raisedAt)}
                  {entry.impediment.resolvedAt === null
                    ? ` · aperto da ${formatDuration(entry.durationMs)}`
                    : ` · risolto il ${formatDate(entry.impediment.resolvedAt)} · durato ${formatDuration(entry.durationMs)}`}
                </p>

                {entry.impediment.description === null ? null : (
                  <p className="mt-2 text-sm break-words">
                    {entry.impediment.description}
                  </p>
                )}

                {entry.workItemTitle === null ? null : (
                  <p className="text-muted-foreground mt-1 text-xs break-words">
                    Emerso su: {entry.workItemTitle}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-muted-foreground text-sm">
        Le durate qui sopra sono la differenza fra due istanti registrati dalla fonte.
        Nessun impedimento è attribuito a una persona: si registra l&apos;ostacolo e
        quanto è durato, non chi lo ha causato.
      </p>
    </main>
  );
}
