import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { organizationIdSchema, type WorkItemState } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";

import { loadProjectFlow, type ColumnOccupancy } from "./data";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Flusso di lavoro · ${slug} · Scrum Master AI` };
}

const STATE_LABELS: Readonly<Record<WorkItemState, string>> = {
  todo: "Da fare",
  in_progress: "In lavorazione",
  in_review: "In revisione",
  blocked: "Bloccato",
  done: "Concluso",
  cancelled: "Annullato",
};

/**
 * How a column reads against its own limit.
 *
 * The colour never carries the meaning on its own: each standing has a word,
 * and the word is what a reader who does not distinguish red from green — or
 * who is listening rather than looking — actually receives.
 */
const STANDING: Readonly<
  Record<ColumnOccupancy["standing"], { readonly label: string; readonly className: string }>
> = {
  within: { label: "entro il limite", className: "text-muted-foreground" },
  "at-limit": { label: "al limite", className: "text-foreground font-medium" },
  over: { label: "oltre il limite", className: "text-destructive font-medium" },
  unknown: { label: "", className: "" },
};

export default async function ProjectFlowPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;

  /*
   * L'istante di riferimento si stabilisce qui, una volta sola.
   *
   * Il motore non guarda mai l'orologio (ADR-0002): riceve l'istante. Se ogni
   * conteggio prendesse il proprio, due colonne della stessa bacheca
   * potrebbero essere misurate in momenti diversi, e la somma non tornerebbe.
   */
  const asOf = new Date();

  const flow = await loadProjectFlow(
    organizationIdSchema.parse(session.organizationId),
    slug,
    asOf,
  );

  if (!flow) notFound();

  const { project, board, columns, byState } = flow;

  /*
   * Gli stati che nessuna colonna rappresenta.
   *
   * Senza questa riga gli elementi annullati sparirebbero dalla bacheca senza
   * spiegazione, e chi guarda concluderebbe che i conti non tornano. Sono
   * calcolati qui perché è pura sottrazione fra due insiemi già noti: la
   * pagina non misura nulla, riordina.
   */
  const covered = new Set(columns.map((entry) => entry.column.state));

  const uncovered = byState.available
    ? [...byState.value.entries()].filter(
        ([state, count]) => !covered.has(state) && count > 0,
      )
    : [];

  const withLimit = columns.filter((entry) => entry.column.wipLimit !== null);
  const over = columns.filter((entry) => entry.standing === "over");

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Flusso di lavoro" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Flusso di lavoro
        </h1>

        <p className="text-muted-foreground text-sm">
          {board === null
            ? "Nessuna bacheca collegata"
            : `Bacheca «${board.name}»`}
          {columns.length > 0
            ? ` · ${formatNumber(columns.length)} colonne · situazione al ${formatDate(flow.asOf)}`
            : ""}
        </p>
      </header>

      {columns.length === 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-base leading-none font-semibold">
              Nessuna colonna nei dati
            </h2>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-3 text-sm">
            <p>
              Le colonne descrivono il flusso che il team segue e da dove arriva la
              corrispondenza fra il nome di una colonna e lo stato canonico di un
              elemento. Non si inseriscono a mano: le porta il connettore della fonte.
            </p>
            <p>
              Per popolare il progetto con una storia sintetica esegui{" "}
              <code className="font-mono text-xs">npm run seed</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-3">
          <h2 className="text-lg font-medium">Le colonne, nell&apos;ordine del flusso</h2>

          <ul className="grid gap-2">
            {columns.map((entry) => {
              const standing = STANDING[entry.standing];

              return (
                <li key={entry.column.id} className="rounded-lg border p-3">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <span className="text-sm font-medium">{entry.column.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      stato canonico: {STATE_LABELS[entry.column.state]}
                    </span>
                  </div>

                  <p className="mt-1 text-sm">
                    {entry.occupancy === null ? (
                      <span className="text-muted-foreground">
                        Conteggio non attribuibile a questa colonna
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">
                          {entry.occupancy === 1
                            ? "1 elemento"
                            : `${formatNumber(entry.occupancy)} elementi`}
                        </span>
                        {entry.column.wipLimit === null ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · nessun limite dichiarato
                          </span>
                        ) : (
                          <>
                            <span className="text-muted-foreground">
                              {" "}
                              · limite {formatNumber(entry.column.wipLimit)}
                            </span>
                            <span className={`ml-1 ${standing.className}`}>
                              · {standing.label}
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {uncovered.length > 0 ? (
        /*
         * Gli elementi che la bacheca non mostra.
         *
         * Un conteggio che non torna è il modo più rapido per far perdere
         * fiducia in una schermata. Dire dove sono finiti costa una riga.
         */
        <Card>
          <CardHeader>
            <h2 className="text-base leading-none font-semibold">
              Elementi in stati che nessuna colonna rappresenta
            </h2>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <ul className="grid gap-1">
              {uncovered.map(([state, count]) => (
                <li key={state} className="text-muted-foreground">
                  {STATE_LABELS[state]}:{" "}
                  {count === 1 ? "1 elemento" : `${formatNumber(count)} elementi`}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Esistono nel modello canonico ma la bacheca della fonte non ha una colonna
              per loro. Non sono scomparsi: semplicemente questa bacheca non li mostra.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/*
       * A cosa serve un limite dichiarato, detto dove lo si legge.
       *
       * Il numero accanto alla colonna non significa nulla per chi non sa che
       * quel limite l'ha scelto la squadra e non il prodotto. È la differenza
       * fra una soglia inventata da noi — che si può discutere — e un impegno
       * che il team ha preso con sé stesso, che è un segnale molto più forte.
       */}
      <aside aria-labelledby="che-cos-e-il-limite">
        <Card className="bg-muted/40">
          <CardHeader>
            <h2 id="che-cos-e-il-limite" className="text-base leading-none font-semibold">
              Che cos&apos;è il limite di una colonna
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              È il numero massimo di elementi che <strong>la squadra stessa</strong> ha
              deciso di tenere contemporaneamente in quella colonna. Non è una soglia
              scelta da questo prodotto: arriva dalla fonte, insieme alla bacheca.
            </p>
            <p>
              Per questo una colonna stabilmente oltre il proprio limite è un segnale
              forte. Non dice «hai superato un numero che abbiamo inventato noi», dice
              «stai superando il patto che avevi fatto con te stesso».
            </p>
            <p className="text-muted-foreground">
              {withLimit.length === 0
                ? "In questo progetto nessuna colonna dichiara un limite: senza quel dato il segnale non è calcolabile, e non viene sostituito da una soglia arbitraria."
                : over.length === 0
                  ? `${formatNumber(withLimit.length)} colonne dichiarano un limite, e nessuna lo sta superando.`
                  : `${formatNumber(withLimit.length)} colonne dichiarano un limite; ${over.length === 1 ? "una lo sta superando" : `${formatNumber(over.length)} lo stanno superando`}.`}
            </p>
          </CardContent>
        </Card>
      </aside>

      <p className="text-muted-foreground text-sm">
        I conteggi di questa pagina sono ricostruiti dalla storia degli stati, non dallo
        stato attuale registrato sull&apos;elemento: è la stessa fonte da cui vengono
        tutte le metriche, e l&apos;unica che sappia rispondere «a quell&apos;istante».{" "}
        <Link
          href="/metriche#items-by-state"
          className="hover:text-foreground underline underline-offset-4"
        >
          Come si calcolano
        </Link>
        .
      </p>
    </main>
  );
}
