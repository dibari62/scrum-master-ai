import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { MetricCard } from "@/components/charts/metric-card";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { organizationIdSchema, type ImprovementStatus } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format";

import { presentCount } from "../../present";
import { loadProjectRetrospectives, type RetrospectiveEntry } from "./data";

export const dynamic = "force-dynamic";

/**
 * Oltre un mese aperto, il riquadro lo segnala.
 *
 * Non è una soglia scientifica ed è dichiarata come tale: con sprint di due
 * settimane, un miglioramento aperto da trenta giorni ha attraversato due
 * retrospettive senza che nessuno lo chiudesse. A quel punto non è più un
 * piano.
 */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Retrospettive · ${slug} · Scrum Master AI` };
}

/**
 * Lo stato di un miglioramento, a parole e non con un colore.
 *
 * «Lasciato cadere» non è un fallimento: il libro ammette esplicitamente di
 * decidere di non agire — «in many cases, just identifying a problem clearly is
 * enough for it to solve itself» — e un'interfaccia che offrisse solo
 * «fatto» / «non fatto» spingerebbe a dichiarare il primo.
 */
const STATUS_WORDS: Readonly<Record<ImprovementStatus, string>> = {
  open: "ancora aperto",
  done: "fatto",
  dropped: "lasciato cadere",
};

function NoteList({
  title,
  notes,
  empty,
}: {
  readonly title: string;
  readonly notes: RetrospectiveEntry["good"];
  readonly empty: string;
}) {
  return (
    <div className="grid content-start gap-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {notes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="bg-muted/50 ring-border/70 rounded-lg px-3 py-2 text-sm ring-1"
            >
              {note.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function ProjectRetrospectivesPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const asOf = new Date();

  const data = await loadProjectRetrospectives(
    organizationIdSchema.parse(session.organizationId),
    slug,
    asOf,
  );

  if (!data) notFound();

  const { project, entries, followUp, leadTime, sprintsWithout } = data;

  const openNow = presentCount(
    followUp.available
      ? { available: true, value: followUp.value.openCount, sampleSize: followUp.sampleSize }
      : followUp,
  );

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Retrospettive" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Retrospettive</h1>

        <p className="text-muted-foreground max-w-prose text-sm">
          Cosa la squadra ha deciso di cambiare, e se poi è cambiato. Le tre colonne sono
          quelle del libro: cosa rifaremmo uguale, cosa faremmo diversamente, e cosa
          proviamo a migliorare. I voti sono totali di squadra — chi ha votato cosa non
          viene registrato da nessuna parte.
        </p>
      </header>

      {/*
       * Il seguito prima dell'elenco, e non è impaginazione.
       *
       * Il valore di una retrospettiva non sta in cosa è stato detto ma in cosa
       * è successo dopo. Mettere il seguito in fondo lo renderebbe una nota a
       * piè di pagina di se stesso — lo stesso errore che il semaforo evita
       * stando in cima alla dashboard.
       */}
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">I miglioramenti hanno avuto un seguito?</h2>

        {!followUp.available ? (
          <p className="text-muted-foreground text-sm">
            Nessun miglioramento è ancora stato deciso in una retrospettiva di questo
            progetto.
          </p>
        ) : (
          <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Ancora aperti"
              value={openNow.value}
              detail={openNow.detail}
              hint="Decisi in retrospettiva e non ancora chiusi."
              emphasis={followUp.value.openCount > 3 ? "warning" : "normal"}
            />
            <MetricCard
              label="Portati a termine"
              value={formatNumber(followUp.value.doneCount)}
              detail={`su ${formatNumber(followUp.value.consideredCount)} considerati`}
              hint="Esclude quelli lasciati cadere: non agire è una scelta legittima."
            />
            <MetricCard
              label="Quota completata"
              value={
                followUp.value.completionShare === null
                  ? null
                  : formatPercent(followUp.value.completionShare, 0)
              }
              detail={
                followUp.value.completionShare === null
                  ? "nulla da completare: tutto lasciato cadere"
                  : `su ${formatNumber(followUp.value.consideredCount)} considerati`
              }
            />
            <MetricCard
              label="Aperto da più tempo"
              value={
                followUp.value.longestOpenMs === null
                  ? null
                  : formatDuration(followUp.value.longestOpenMs)
              }
              detail={
                followUp.value.longestOpenMs === null
                  ? "nessuno aperto"
                  : leadTime.available
                    ? `di solito se ne chiude uno in ${formatDuration(leadTime.value)}`
                    : "nessuno ancora chiuso, non c'è un'abitudine da confrontare"
              }
              emphasis={
                followUp.value.longestOpenMs !== null &&
                followUp.value.longestOpenMs > THIRTY_DAYS_MS
                  ? "warning"
                  : "normal"
              }
            />
          </div>
        )}
      </section>

      {sprintsWithout.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sprint chiusi senza retrospettiva</CardTitle>
            <CardDescription>
              Detto invece che taciuto: uno sprint che finisce senza guardarsi indietro è
              un fatto sulla squadra, e una pagina che lo omettesse lascerebbe sparire
              l&apos;abitudine in silenzio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {sprintsWithout.map((sprint) => (
                <li key={sprint.id} className="text-muted-foreground">
                  {sprint.name}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4">
        <h2 className="text-lg font-medium">Le riunioni, dalla più recente</h2>

        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nessuna retrospettiva registrata su questo progetto.
          </p>
        ) : (
          entries.map((entry) => (
            <Card key={entry.retrospective.id} data-retrospective>
              <CardHeader>
                <CardTitle className="text-base">
                  {entry.sprint?.name ?? "Sprint non più disponibile"}
                </CardTitle>
                <CardDescription>
                  Tenuta il {formatDate(entry.retrospective.heldAt)} ·{" "}
                  {formatNumber(entry.retrospective.participantCount)} partecipanti
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <NoteList
                    title="Cosa rifaremmo uguale"
                    notes={entry.good}
                    empty="Niente annotato in questa colonna."
                  />
                  <NoteList
                    title="Cosa faremmo diversamente"
                    notes={entry.couldHaveDoneBetter}
                    empty="Niente annotato in questa colonna."
                  />
                </div>

                <div className="grid gap-2">
                  <h4 className="text-sm font-medium">Cosa abbiamo deciso di migliorare</h4>

                  {entry.improvements.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nessun miglioramento deciso in questa riunione.
                    </p>
                  ) : (
                    <ul className="grid gap-2">
                      {entry.improvements.map((action) => (
                        <li
                          key={action.id}
                          className="ring-border/70 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-sm ring-1"
                        >
                          <span>{action.title}</span>
                          <span className="text-muted-foreground text-xs">
                            {STATUS_WORDS[action.status]}
                            {/*
                             * I voti solo sopra la soglia di partecipanti.
                             * Con due persone nella stanza un totale dice
                             * quasi esattamente come ha votato ciascuna: non
                             * è più un aggregato (§8.2).
                             */}
                            {entry.showVotes
                              ? ` · ${formatNumber(action.votes)} voti`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {entry.showVotes ? null : (
                    <p className="text-muted-foreground text-xs">
                      I voti non sono mostrati: con meno di tre partecipanti un totale
                      direbbe come ha votato ciascuno.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </main>
  );
}
