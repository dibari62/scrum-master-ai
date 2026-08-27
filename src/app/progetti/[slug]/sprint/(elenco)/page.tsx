import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BurndownChart } from "@/components/charts/burndown-chart";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import {
  CHECKLIST_MOMENTS,
  CHECKLIST_MOMENT_LABELS,
  CHECKLIST_STATUS_LABELS,
  MAX_STORIES_PER_SPRINT,
  MAX_STORY_POINTS,
  MIN_STORIES_PER_SPRINT,
  MIN_STORY_POINTS,
  type ChecklistEntry,
} from "@/metrics";
import { cn } from "@/lib/utils";

import { unavailableReason } from "../../../present";
import { loadProjectSprints, type SprintRow, type SprintStatus } from "../data";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Sprint · ${slug} · Scrum Master AI` };
}

const STATUS_LABELS: Readonly<Record<SprintStatus, string>> = {
  planned: "Non ancora iniziato",
  running: "In corso",
  // Non «concluso»: la data di fine è passata ma nessuno ha chiuso lo sprint,
  // e i due fatti sono campi diversi proprio perché sono cose diverse.
  ended: "Terminato, non chiuso",
  closed: "Concluso",
};

/**
 * Il colore ripete lo stato, non lo sostituisce.
 *
 * Ogni riquadro porta comunque la sua etichetta scritta: chi non distingue i
 * colori, e chi legge la pagina con un lettore di schermo, riceve la stessa
 * informazione.
 */
const STATUS_STYLES: Readonly<Record<SprintStatus, string>> = {
  planned: "border-muted-foreground/40 text-muted-foreground",
  running: "border-primary bg-primary text-primary-foreground",
  ended: "border-destructive/50 text-destructive",
  closed: "border-muted-foreground/40 text-muted-foreground",
};

/** When the item count was taken, in words: the figure is meaningless without it. */
const COUNT_MOMENT: Readonly<Record<SprintStatus, string>> = {
  planned: "finora",
  running: "finora",
  ended: "alla data di fine",
  closed: "alla chiusura",
};

function countText(row: SprintRow): string {
  const reason = unavailableReason(row.itemCount);
  if (reason !== null || !row.itemCount.available) {
    // Mai «0 elementi»: uno sprint di cui non conosciamo la composizione e uno
    // sprint vuoto sono affermazioni diverse (`MetricResult`).
    return `elementi non disponibili — ${reason ?? "nessun dato"}`;
  }

  const count = row.itemCount.value;
  const noun = count === 1 ? "elemento" : "elementi";

  return `${formatNumber(count)} ${noun} ${COUNT_MOMENT[row.status]}`;
}

/**
 * The guidelines this sprint misses, each with the reason the book gives.
 *
 * An empty list is the normal case and draws nothing: a panel that says "tutto
 * a posto" on every sprint trains the eye to skip the whole area, including the
 * day it has something to say.
 */
function guidelineNotes(row: SprintRow): readonly string[] {
  const notes: string[] = [];
  const { guidelines } = row;

  // «1 storie» è il genere di dettaglio che fa sembrare generato un testo che
  // invece è stato scritto. Costa una riga.
  const stories = (count: number): string =>
    `${formatNumber(count)} ${count === 1 ? "storia" : "storie"}`;

  if (guidelines.storyCountDirection === "below") {
    notes.push(
      `${stories(guidelines.storyCount)}: sotto le ${formatNumber(MIN_STORIES_PER_SPRINT)} che il libro consiglia — di solito significa storie troppo grandi.`,
    );
  }

  if (guidelines.storyCountDirection === "above") {
    notes.push(
      `${stories(guidelines.storyCount)}: sopra le ${formatNumber(MAX_STORIES_PER_SPRINT)} che il libro consiglia — di solito significa che la squadra ha preso troppo.`,
    );
  }

  const above = guidelines.storySize.filter((one) => one.direction === "above");
  const below = guidelines.storySize.filter((one) => one.direction === "below");

  if (above.length > 0) {
    notes.push(
      `${stories(above.length)} sopra ${formatNumber(MAX_STORY_POINTS)} punti — oltre quella soglia una stima è più un'ipotesi che una misura.`,
    );
  }

  if (below.length > 0) {
    notes.push(
      `${stories(below.length)} sotto ${formatNumber(MIN_STORY_POINTS)} punti — seguirle come storie costa più che farle.`,
    );
  }

  return notes;
}

/**
 * Il riassunto che compare accanto alla checklist chiusa.
 *
 * Conta **solo ciò che il portale può verificare**: mettere nel denominatore
 * anche le voci umane produrrebbe un «4 su 14» che si legge come una squadra
 * indietro, mentre le dieci restanti non sono in ritardo — semplicemente
 * nessun database sa se siano state fatte.
 */
function checklistSummary(entries: readonly ChecklistEntry[]): string {
  const verifiable = entries.filter(
    (entry) => entry.status === "done" || entry.status === "todo",
  );
  const done = verifiable.filter((entry) => entry.status === "done").length;

  if (verifiable.length === 0) return "nulla di verificabile in questo momento";

  return `${formatNumber(done)} su ${formatNumber(verifiable.length)} verificabili`;
}

export default async function ProjectSprintsPage({ params }: PageProps) {  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;

  /*
   * L'istante di riferimento si decide qui e si passa in basso: `src/metrics`
   * si rifiuta di leggere l'orologio perché i suoi risultati restino
   * riproducibili, e sceglierlo al bordo è ciò che rende quella disciplina
   * utilizzabile invece che solo di principio.
   */
  const asOf = new Date();

  const list = await loadProjectSprints(
    organizationIdSchema.parse(session.organizationId),
    slug,
    asOf,
  );

  if (!list) notFound();

  const { project, rows } = list;

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Sprint" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sprint</h1>

        <p className="text-muted-foreground text-sm">
          {rows.length === 1
            ? "1 sprint · dal più recente"
            : `${formatNumber(rows.length)} sprint · dal più recente`}
          {` · dati al ${formatDate(list.asOf)}`}
        </p>
      </header>

      {rows.length === 0 ? (
        /*
         * Lo stato vuoto dice cosa fare, non che la lista è vuota: è la prima
         * schermata che vede chi apre un progetto appena creato.
         */
        <Card>
          <CardHeader>
            <h2 className="text-base leading-none font-semibold">Nessuno sprint</h2>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-3 text-sm">
            <p>
              Gli sprint arrivano dalle fonti collegate: non si creano da questa pagina,
              perché il progetto racconta ciò che è successo nello strumento in cui la
              squadra lavora davvero.
            </p>
            <p>
              Per popolare il progetto con una storia sintetica esegui{" "}
              <code className="font-mono text-xs">npm run seed</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => (
            <li key={row.sprint.id} className="grid gap-2 rounded-lg border p-4">
              {/*
               * Nome e stato su una riga sola solo quando c'è spazio: a 375
               * pixel un nome di sprint e un'etichetta come «Terminato, non
               * chiuso» non convivono, e affiancarli spingerebbe la seconda
               * oltre il bordo.
               */}
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <h2 className="font-medium">{row.sprint.name}</h2>

                <span
                  className={cn(
                    "inline-flex w-fit shrink-0 rounded-md border px-2 py-0.5 text-xs",
                    STATUS_STYLES[row.status],
                  )}
                >
                  {STATUS_LABELS[row.status]}
                </span>
              </div>

              {/*
               * L'obiettivo arriva da una fonte esterna: è testo, mai
               * marcatura. React lo scherma da solo, ed è esattamente ciò che
               * serve qui (§8.1).
               */}
              <p className={cn("text-sm", row.sprint.goal === null && "text-muted-foreground")}>
                {row.sprint.goal ?? "Nessun obiettivo dichiarato."}
              </p>

              <p className="text-muted-foreground text-xs">
                {`Dal ${formatDate(row.sprint.startsAt)} al ${formatDate(row.sprint.endsAt)}`}
                {row.sprint.completedAt
                  ? ` · chiuso il ${formatDate(row.sprint.completedAt)}`
                  : ""}
              </p>

              <p className="text-sm tabular-nums">{countText(row)}</p>

              {/*
               * Gli avvisi del libro, che sono avvisi e non divieti.
               *
               * «We normally strive for stories weighted two to eight man-days»
               * e «da 5 a 15 storie per sprint» (pag. 43). Uno sprint fuori da
               * quegli intervalli non è invalido: è da guardare due volte, e
               * il motivo tipico è scritto accanto perché un avviso senza la
               * sua causa probabile è solo un cartello rosso.
               */}
              {guidelineNotes(row).length > 0 ? (
                <ul className="text-muted-foreground grid gap-1 text-xs">
                  {guidelineNotes(row).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}

              {/*
               * Il burndown di *questo* sprint, anche se è già chiuso.
               *
               * La dashboard ne disegna uno solo, per lo sprint più recente:
               * giusto lì, perché è l'unico grafico su cui si può ancora
               * intervenire. La conseguenza però era che uno sprint concluso
               * non aveva un burndown da nessuna parte — «come è andato lo
               * sprint 2, giorno per giorno» non aveva risposta, benché il
               * motore sapesse calcolarla da sempre.
               */}
              {row.burndown.available ? (
                <BurndownChart
                  title={`Burndown — ${row.sprint.name}`}
                  unitLabel="punti"
                  points={row.burndown.value.points.map((point) => ({
                    at: point.at,
                    remaining: point.remaining.points ?? 0,
                  }))}
                  committed={row.burndown.value.points[0]?.ideal ?? 0}
                  totalDays={row.burndown.value.totalWorkingDays}
                />
              ) : (
                <p className="text-muted-foreground text-xs">
                  Burndown non disponibile: nessun dato di perimetro per questo sprint.
                </p>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link
                  href={`/progetti/${project.slug}/sprint/${row.sprint.id}`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Pagina informativa dello sprint
                </Link>
                <Link
                  href={`/progetti/${project.slug}/elementi?sprint=${row.sprint.id}`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Elementi che oggi risultano in questo sprint
                </Link>
              </div>

              {/*
               * La checklist del capitolo 16, per questo sprint.
               *
               * Sta dentro lo sprint e non su una pagina a sé perché le sue
               * voci parlano di *questa* iterazione: «crea la pagina
               * informativa», «tieni la retrospettiva». Una checklist di
               * progetto non avrebbe nulla contro cui essere verificata.
               */}
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Checklist dello Scrum Master · {checklistSummary(row.checklist)}
                </summary>

                <div className="grid gap-3 pt-3">
                  {CHECKLIST_MOMENTS.map((moment) => (
                    <div key={moment} className="grid gap-1">
                      <h3 className="text-xs font-semibold tracking-wide uppercase">
                        {CHECKLIST_MOMENT_LABELS[moment]}
                      </h3>
                      <ul className="grid gap-1">
                        {row.checklist
                          .filter((entry) => entry.moment === moment)
                          .map((entry) => (
                            <li
                              key={entry.id}
                              data-checklist-entry={entry.status}
                              className="text-sm"
                            >
                              <span
                                className={
                                  entry.status === "todo"
                                    ? "font-medium"
                                    : "text-muted-foreground"
                                }
                              >
                                {entry.text}
                              </span>{" "}
                              <span className="text-muted-foreground text-xs">
                                — {CHECKLIST_STATUS_LABELS[entry.status]}: {entry.detail}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}

                  {/*
                   * Il libro chiude la checklist così, ed è la parte che
                   * conta più delle spunte.
                   */}
                  <p className="text-muted-foreground border-t pt-2 text-xs">
                    Metà di queste voci <strong>nessun portale può spuntarle</strong>: sono
                    conversazioni, riunioni, un foglio appeso a un muro. Restano scritte
                    perché sono lavoro, e ometterle farebbe sembrare il mestiere dello Scrum
                    Master più piccolo di quanto sia. Il libro chiude proprio dicendo di
                    allenare la squadra a farle senza di lui: «over time, try to make
                    yourself redundant».
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        /*
         * I due numeri possono non coincidere, e va detto prima che qualcuno
         * lo scopra da solo.
         *
         * Il conteggio viene dalla storia della composizione dello sprint;
         * l'elenco collegato filtra sul legame attuale fra elemento e sprint.
         * Un elemento non finito e trascinato avanti compare nel primo e non
         * nel secondo. Tacere la differenza farebbe sembrare sbagliato uno dei
         * due numeri, mentre rispondono a due domande diverse.
         */
        <Card>
          <CardHeader>
            {/*
             * Intestazione vera: chi salta di intestazione in intestazione con
             * un lettore di schermo deve poter arrivare anche a questa nota,
             * che spiega una differenza altrimenti scambiata per un errore.
             */}
            <h2 className="text-base leading-none font-semibold">
              Perché il conteggio può non coincidere con l&apos;elenco
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              Il numero di elementi qui sopra è ricostruito dalla storia dello sprint:
              dice cosa lo sprint conteneva <strong>in quel momento</strong>. Il
              collegamento apre invece gli elementi che risultano{" "}
              <strong>adesso</strong> in quello sprint.
            </p>
            <p>
              Un elemento non concluso e portato nello sprint successivo compare nel primo
              conteggio e non nel secondo: è lo stesso motivo per cui la velocity di uno
              sprint chiuso non cambia quando la squadra riprende in mano il lavoro
              rimasto.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <footer className="text-muted-foreground border-t pt-6 text-xs">
        I conteggi di questa pagina sono calcolati in codice deterministico e testato.
        Nessuno è stato prodotto da un modello linguistico.{" "}
        <Link
          href="/metriche#sprint-item-count"
          className="hover:text-foreground underline underline-offset-4"
        >
          Come si calcolano
        </Link>
        .
      </footer>
    </main>
  );
}
