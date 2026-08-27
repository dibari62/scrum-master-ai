import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/charts/data-table";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACCEPTANCE_THRESHOLD_LABELS,
  ACCEPTANCE_THRESHOLD_MEANINGS,
  organizationIdSchema,
  thresholdAtPosition,
} from "@/domain";
import { auth } from "@/lib/auth";
import { mayConfigureAgent } from "@/lib/agents/scrum-agent";
import { formatEstimate, formatNumber } from "@/lib/format";
import { READINESS_LABELS } from "@/metrics";
import { STATE_LABELS } from "@/lib/state-words";

import { setAcceptanceThresholdsAction } from "./actions";
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

  const list = await loadBacklog(
    organizationIdSchema.parse(session.organizationId),
    slug,
    mayConfigureAgent(session.role),
    /*
     * L'istante si decide qui e si passa in basso: `src/metrics` si rifiuta di
     * leggere l'orologio perché i suoi risultati restino riproducibili.
     */
    new Date(),
  );
  if (!list) notFound();

  const { project, items, total, unplacedCount, describedCount, thresholds, coverage, plan } =
    list;

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

          <Card>
            <CardContent className="grid gap-3 pt-6">
              <div className="grid gap-1">
                <h2 className="text-base font-semibold">Soglie di accettazione</h2>
                <p className="text-muted-foreground text-sm">
                  Dove passa la linea fra ciò che è <strong>dovuto nella 1.0</strong> e ciò
                  che può aspettare. Sono tagli sull&apos;ordine, non punteggi: spostare un
                  elemento più in alto lo rende obbligatorio, senza toccare altro.
                </p>
              </div>

              {thresholds === null ? (
                <p className="text-muted-foreground text-sm">
                  Nessuna soglia dichiarata. Il backlog resta un elenco di cose da fare,
                  senza dire quali sono <strong>promesse</strong>.
                </p>
              ) : (
                <DataTable
                  caption="Quanto lavoro comporta ciascuna fascia di impegno"
                  rows={coverage.bands}
                  getKey={(band) => band.threshold}
                  rowAttribute="data-band"
                  minWidth="min-w-[38rem]"
                  columns={[
                    {
                      key: "fascia",
                      header: "Fascia",
                      className: "min-w-[16rem]",
                      cell: (band) => (
                        <span className="font-medium">
                          {ACCEPTANCE_THRESHOLD_LABELS[band.threshold]}
                        </span>
                      ),
                    },
                    {
                      key: "significato",
                      header: "Se manca",
                      className: "min-w-[20rem]",
                      cell: (band) => ACCEPTANCE_THRESHOLD_MEANINGS[band.threshold],
                    },
                    {
                      key: "elementi",
                      header: "Elementi",
                      align: "end",
                      cell: (band) => formatNumber(band.itemCount),
                    },
                    {
                      key: "stima",
                      header: "Stima",
                      align: "end",
                      cell: (band) =>
                        band.total.points === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatEstimate(band.total.points, "points")
                        ),
                    },
                  ]}
                />
              )}

              {coverage.unclassified > 0 && thresholds !== null ? (
                <p className="text-muted-foreground text-xs">
                  {formatNumber(coverage.unclassified)} elementi non ricadono in alcuna
                  fascia: non hanno una posizione, e <strong>«non collocato» non è
                  «ipotetico»</strong>.
                </p>
              ) : null}

              {list.canConfigure ? (
                <form
                  action={setAcceptanceThresholdsAction}
                  className="flex flex-wrap items-end gap-3 border-t pt-3"
                >
                  <input type="hidden" name="slug" value={project.slug} />

                  {(
                    [
                      ["must", "Obbligatori", thresholds?.must],
                      ["should", "Attesi", thresholds?.should],
                      ["later", "Dovuti dopo", thresholds?.later],
                    ] as const
                  ).map(([name, label, value]) => (
                    <div key={name} className="grid gap-1.5">
                      <Label htmlFor={name}>{label}</Label>
                      <Input
                        id={name}
                        name={name}
                        type="number"
                        min={0}
                        className="w-28"
                        defaultValue={value ?? ""}
                      />
                    </div>
                  ))}

                  <Button type="submit" variant="outline">
                    Salva le soglie
                  </Button>

                  {/*
                   * Come si cancellano si dice, non si lascia scoprire.
                   *
                   * «Nessuna soglia» non è la stessa cosa di «tutte a zero»:
                   * zero dichiara che non si deve nulla nella 1.0, che è
                   * un'affermazione sul contratto.
                   */}
                  <p className="text-muted-foreground w-full text-xs">
                    Quanti elementi, <strong>partendo dalla cima</strong>, ricadono in
                    ciascuna fascia. Il resto è ipotetico. Svuotando i tre campi le soglie
                    tornano non dichiarate, che è diverso da dichiararle tutte a zero.
                  </p>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-6">
              <div className="grid gap-1">
                <h2 className="text-base font-semibold">Piano di rilascio</h2>
                <p className="text-muted-foreground text-sm">
                  Il backlog tagliato in sprint, prendendo storie in ordine finché
                  aggiungerne un&apos;altra supererebbe la velocity stimata.
                </p>
              </div>

              {plan === null ? (
                <p className="text-muted-foreground text-sm">
                  Nessun piano: serve almeno uno sprint chiuso con stime in punti da cui
                  ricavare la velocity. <strong>Non viene chiesta a chi guarda</strong> —
                  un numero digitato sarebbe una previsione travestita da misura.
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm tabular-nums">
                    Velocity stimata <strong>{formatNumber(plan.velocity, 1)} punti</strong>
                    {list.velocitySource === null ? "" : ` · ${list.velocitySource}`}
                  </p>

                  <DataTable
                    caption="Come il backlog si distribuisce sugli sprint futuri"
                    rows={plan.sprints}
                    getKey={(sprint) => String(sprint.number)}
                    rowAttribute="data-planned-sprint"
                    minWidth="min-w-[38rem]"
                    columns={[
                      {
                        key: "sprint",
                        header: "Sprint",
                        align: "end",
                        cell: (sprint) => formatNumber(sprint.number),
                      },
                      {
                        key: "contenuto",
                        header: "Contiene",
                        className: "min-w-[24rem]",
                        cell: (sprint) =>
                          sprint.items.map((entry) => entry.title).join(" · "),
                      },
                      {
                        key: "punti",
                        header: "Punti",
                        align: "end",
                        cell: (sprint) => (
                          <span className={sprint.overflows ? "text-destructive" : undefined}>
                            {formatNumber(sprint.points)}
                          </span>
                        ),
                      },
                    ]}
                  />

                  {plan.sprints.some((sprint) => sprint.overflows) ? (
                    <p className="text-destructive text-xs">
                      Uno sprint supera la velocity stimata perché contiene una storia più
                      grande di uno sprint intero: <strong>va spezzata</strong> prima di
                      poter essere pianificata.
                    </p>
                  ) : null}

                  {plan.unplannable.length > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {formatNumber(plan.unplannable.length)} elementi restano fuori dal
                      piano perché <strong>non sono stimati</strong>. Non valgono zero:
                      valgono un numero che nessuno ha ancora scritto, e il libro dice di
                      stimare i più importanti, non tutti.
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-6">
              <div className="grid gap-1">
                <h2 className="text-base font-semibold">Pronti per uno sprint</h2>
                <p className="text-muted-foreground text-sm">
                  La <strong>Definition of Ready</strong> è «a checklist for when a story is
                  ready to be pulled into a sprint». Il controllo guarda i primi{" "}
                  {formatNumber(list.readiness.considered)} elementi — quelli che entrerebbero
                  nel prossimo sprint — perché segnalare l&apos;intero backlog produrrebbe
                  avvisi su cui nessuno può agire.
                </p>
              </div>

              <p className="text-sm tabular-nums">
                {list.readiness.notReady.length === 0
                  ? `Tutti e ${formatNumber(list.readiness.considered)} hanno stima, «come si dimostra» e posizione.`
                  : `${formatNumber(list.readiness.ready)} su ${formatNumber(list.readiness.considered)} sono pronti.`}
              </p>

              {list.readiness.notReady.length > 0 ? (
                <DataTable
                  caption="Elementi in cima al backlog a cui manca qualcosa"
                  rows={list.readiness.notReady}
                  getKey={(entry) => entry.itemId}
                  getHref={(entry) => `/progetti/${project.slug}/elementi/${entry.itemId}`}
                  rowAttribute="data-not-ready"
                  minWidth="min-w-[34rem]"
                  columns={[
                    {
                      key: "elemento",
                      header: "Elemento",
                      className: "min-w-[20rem]",
                      cell: (entry) => <span className="font-medium">{entry.title}</span>,
                    },
                    {
                      key: "manca",
                      header: "Che cosa manca",
                      className: "min-w-[16rem]",
                      cell: (entry) =>
                        entry.missing.map((what) => READINESS_LABELS[what]).join(" · "),
                    },
                  ]}
                />
              ) : null}

              {/*
               * Ciò che il portale non può controllare si dichiara.
               *
               * Il libro dà la tecnica più semplice — «make sure that all the
               * fields are filled in» — ed è quella verificabile. Che una
               * squadra abbia davvero *capito* una storia non è deducibile da
               * una riga di database, e una spunta verde su quello sarebbe una
               * bugia.
               */}
              {list.definitionOfReady.length > 0 ? (
                <div className="grid gap-1 border-t pt-3">
                  <p className="text-muted-foreground text-xs">
                    Questa squadra chiede anche, e su questo il portale non può pronunciarsi:
                  </p>
                  <ul className="text-muted-foreground list-disc pl-5 text-xs">
                    {list.definitionOfReady.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Il controllo qui sopra guarda i tre campi che il libro nomina. Tutto ciò
                  che un database non può sapere — se la squadra abbia davvero capito la
                  storia — va dichiarato nella Definition of Ready del progetto, che non è
                  ancora scritta.
                </p>
              )}
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
                key: "fascia",
                header: "Impegno",
                className: "min-w-[13rem]",
                cell: (item) => {
                  /*
                   * La fascia si deriva dalla posizione nella lista mostrata,
                   * non da un'etichetta sull'elemento.
                   *
                   * È la stessa regola del motore: una sola fonte per il fatto
                   * «questo è obbligatorio», così spostare un elemento lo
                   * riclassifica da solo invece di lasciare due verità.
                   */
                  const band =
                    item.backlogOrder === null
                      ? null
                      : thresholdAtPosition(items.indexOf(item), thresholds);

                  return band === null ? (
                    <span className="text-muted-foreground">
                      {thresholds === null ? "non dichiarato" : "non collocato"}
                    </span>
                  ) : (
                    ACCEPTANCE_THRESHOLD_LABELS[band]
                  );
                },
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
