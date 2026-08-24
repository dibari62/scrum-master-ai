import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { unavailableReason } from "../../present";
import { loadProjectSprints, type SprintRow, type SprintStatus } from "./data";

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

export default async function ProjectSprintsPage({ params }: PageProps) {
  const session = await auth();
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
    <main className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
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

              <p className="text-sm">
                <Link
                  href={`/progetti/${project.slug}/elementi?sprint=${row.sprint.id}`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Elementi che oggi risultano in questo sprint
                </Link>
              </p>
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
