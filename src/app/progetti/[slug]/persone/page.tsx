import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DataTable } from "@/components/charts/data-table";
import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { organizationIdSchema, type SourceSystem } from "@/domain";
import { auth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";

import { loadProjectPeople } from "./data";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Persone · ${slug} · Scrum Master AI` };
}

/** Where a record came from, in words. "seed" means nothing to a reader. */
const SOURCE_LABELS: Readonly<Record<SourceSystem, string>> = {
  seed: "dati sintetici",
  github: "GitHub",
  jira: "Jira",
};

export default async function ProjectPeoplePage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;

  const roster = await loadProjectPeople(
    organizationIdSchema.parse(session.organizationId),
    slug,
  );

  if (!roster) notFound();

  const { project, people, withEmail } = roster;

  /*
   * Quante persone, e quante hanno un indirizzo.
   *
   * Sono due fatti sull'anagrafica — quanto è popolata e quanto è completa la
   * fonte — non due misure su qualcuno. La frase si compone qui perché la
   * pagina formatta, e ciò che conta è già stato contato nel caricamento.
   */
  const emailSummary =
    people.length === 0
      ? null
      : withEmail === people.length
        ? "Tutte hanno un indirizzo email registrato nella fonte."
        : withEmail === 0
          ? "Nessuna ha un indirizzo email registrato nella fonte."
          : `${formatNumber(withEmail)} su ${formatNumber(people.length)} hanno un indirizzo email registrato nella fonte.`;

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Persone" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Persone</h1>

        <p className="text-muted-foreground text-sm">
          {people.length === 1
            ? "1 persona compare nei dati di questo progetto"
            : `${formatNumber(people.length)} persone compaiono nei dati di questo progetto`}
          {emailSummary === null ? "" : ` · ${emailSummary}`}
        </p>
      </header>

      {/*
       * Il riquadro non è decorazione ed è la ragione per cui questa pagina
       * può esistere.
       *
       * La tentazione ovvia, aprendo un elenco di persone, è affiancare a
       * ciascun nome quanti elementi ha chiuso. §8.2 lo vieta, ma una regola
       * che vive solo in un file di istruzioni è invisibile a chi usa il
       * prodotto: chi legge vede solo un elenco povero e conclude che manca
       * qualcosa. Scritta qui, la regola diventa una scelta dichiarata invece
       * di una lacuna.
       *
       * Sta prima dell'elenco, non dopo, perché va letta prima di cercare i
       * numeri che non ci sono.
       */}
      <aside aria-labelledby="perche-nessun-numero">
        <Card className="border-primary/40 bg-muted/40">
          <CardHeader>
            {/*
             * Un'intestazione vera, non un titolo finto: chi naviga con un
             * lettore di schermo salta di intestazione in intestazione, e
             * questo riquadro è proprio ciò che non deve poter sfuggire.
             */}
            <h2 id="perche-nessun-numero" className="text-base leading-none font-semibold">
              Perché qui non ci sono numeri per persona
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              Questo prodotto misura <strong>il processo, non le persone</strong>. In
              questa pagina non troverai quanti elementi ha chiuso ciascuno, né una
              classifica, né una velocity individuale: sono misure che questo progetto si
              vieta di produrre, perché trasformerebbero uno strumento di miglioramento in
              uno strumento di valutazione.
            </p>
            <p>
              Le persone sono registrate per una ragione precisa: serve sapere a chi
              attribuire un commento, una revisione o l&apos;assegnazione di un elemento.
              Non sono qui perché se ne misuri il rendimento, ed è per questo che
              l&apos;elenco è breve.
            </p>
            <p>
              Per lo stesso motivo lo Scrum Master AI non deduce l&apos;umore o il clima
              di una singola persona dalle sue attività: nel contesto lavorativo europeo è
              una pratica vietata.
            </p>
            {/*
             * I collegamenti stanno su righe proprie, non dentro la frase.
             *
             * Un collegamento inline che va a capo si spezza in due rettangoli
             * e il centro del suo riquadro cade nello spazio fra le righe: il
             * clic finisce sul paragrafo. La suite di adattamento misura
             * esattamente questo, e qui lo aveva colto.
             */}
            <p>I numeri esistono, e sono aggregati sulla squadra e sul flusso di lavoro:</p>
            <ul className="grid gap-1">
              <li>
                <Link
                  href={`/progetti/${project.slug}`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Dashboard del progetto
                </Link>
              </li>
              <li>
                <Link
                  href={`/progetti/${project.slug}/elementi`}
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Elenco degli elementi
                </Link>
              </li>
            </ul>
          </CardContent>
        </Card>
      </aside>

      {people.length === 0 ? (
        /*
         * Lo stato vuoto è la prima schermata di un progetto nuovo: deve dire
         * cosa fare, non limitarsi a constatare che la lista è vuota.
         */
        <Card>
          <CardHeader>
            <h2 className="text-base leading-none font-semibold">Nessuna persona nei dati</h2>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-3 text-sm">
            <p>
              Le persone non si inseriscono a mano: compaiono qui quando una fonte
              collegata le nomina — chi ha aperto un elemento, chi lo ha spostato, chi ha
              commentato.
            </p>
            <p>
              Per popolare questo progetto con una storia sintetica esegui{" "}
              <code className="font-mono text-xs">npm run seed</code>. Con una fonte reale
              collegata, l&apos;elenco si riempie alla prima sincronizzazione.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-3">
          <h2 className="text-lg font-medium">Anagrafica</h2>

          <DataTable
            caption="Persone che compaiono nei dati del progetto"
            rows={people}
            getKey={(person) => person.id}
            minWidth="min-w-[30rem]"
            columns={[
              {
                key: "nome",
                header: "Nome",
                className: "min-w-[12rem]",
                cell: (person) => (
                  <span className="font-medium">{person.displayName}</span>
                ),
              },
              {
                key: "email",
                header: "Email",
                className: "min-w-[14rem]",
                cell: (person) =>
                  person.email ?? (
                    <span className="text-muted-foreground">
                      nessun indirizzo nella fonte
                    </span>
                  ),
              },
              {
                key: "origine",
                header: "Origine",
                cell: (person) => SOURCE_LABELS[person.source],
              },
            ]}
          />

          {/*
           * Ciò che manca va detto, non lasciato indovinare (R6).
           *
           * Ruolo, stato di attività e data di ingresso nel team sono le
           * colonne che un lettore si aspetta e non trova: la tabella non le
           * contiene, e non vanno aggiunte per riempire una schermata. Prima
           * serve la ragione per cui il dato esiste, poi la colonna; dedurle
           * dall'attività, poi, sarebbe esattamente la misura individuale che
           * il riquadro qui sopra dichiara di non fare.
           */}
          <p className="text-muted-foreground text-sm">
            Di ogni persona il modello registra soltanto il nome, l&apos;indirizzo email
            quando la fonte lo espone e da quale fonte proviene il record. Ruolo, stato di
            attività e data di ingresso nel team non compaiono perché nessuna fonte
            collegata li dichiara: non vengono dedotti dall&apos;attività delle persone, e
            non si aggiunge una colonna al modello per riempire una pagina.
          </p>
        </section>
      )}
    </main>
  );
}
