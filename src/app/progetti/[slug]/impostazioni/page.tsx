import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { brainReady, connectorReady } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/format";

import { loadSettings } from "./data";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

type PageProps = {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Impostazioni · ${slug} · Scrum Master AI` };
}

/**
 * Le impostazioni di un progetto: da dove arrivano i dati, e chi scrive i testi.
 *
 * Due domande diverse su una pagina sola perché sono le due cose che vanno fatte
 * **prima** che il portale serva a qualcosa, e mandare qualcuno in due posti per
 * completare un'unica configurazione è il modo per lasciarla a metà.
 *
 * ADR-0010: la chiave del modello la porta chi usa il portale. Noi la custodiamo
 * cifrata e non la restituiamo mai a un browser — nemmeno a chi l'ha inserita.
 */
export default async function ImpostazioniPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const saved = (await searchParams)["salvato"] === "1";
  const view = await loadSettings(slug);

  if (!view) notFound();

  const { project, settings, canConfigure, custodyReady } = view;

  const dataReady = connectorReady({
    connector: settings.connector,
    connectorConfig: settings.connectorConfig,
    connectorSecret: settings.connectorSecret.configured ? "v1.x.y.z" : null,
  });

  const modelReady = brainReady({
    brainProvider: settings.brainProvider,
    brainApiKey: settings.brainApiKey.configured ? "v1.x.y.z" : null,
  });

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${project.slug}` },
            { label: "Impostazioni" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Impostazioni</h1>
        <p className="text-muted-foreground">
          Come questo progetto è collegato al mondo: da dove prende i dati, e con quale
          modello li racconta.
        </p>
      </header>

      {/*
       * Lo stato prima del modulo.
       *
       * Chi arriva qui vuole sapere due cose — «funziona?» e «cosa manca?» — e
       * scoprirlo scorrendo un modulo di quindici campi significa non scoprirlo.
       */}
      <Card>        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5" data-stato="dati">
            <p className="font-medium">
              Dati: {dataReady ? "collegati" : "non ancora collegati"}
            </p>
            <p className="text-muted-foreground">
              {describeConnector(settings.connector, dataReady)}
              {settings.lastSyncedAt
                ? ` Ultima lettura il ${formatDate(settings.lastSyncedAt)}.`
                : ""}
            </p>
          </div>

          <div className="grid gap-0.5" data-stato="modello">
            {/*
             * «Pronto» per il modello finto sarebbe stato vero e fuorviante
             * insieme: risponde davvero, ma con segnaposto. Chi legge «pronto»
             * accanto a «nessun modello collegato» si chiede quale delle due
             * frasi credere.
             */}
            <p className="font-medium">
              Modello:{" "}
              {settings.brainProvider === "fake"
                ? "nessuno"
                : modelReady
                  ? "pronto"
                  : "in attesa di una chiave"}
            </p>
            <p className="text-muted-foreground">{describeBrain(settings.brainProvider)}</p>
          </div>
        </CardContent>
      </Card>

      {saved ? (
        /*
         * La conferma la rende il server, non il modulo.
         *
         * Il modulo si rimonta dopo un salvataggio — è così che i menu mostrano
         * i valori appena scritti — e un rimontaggio azzera qualunque messaggio
         * tenuto nel suo stato. Qui sopravvive perché non vive lì.
         */
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          Impostazioni salvate.
        </p>
      ) : null}

      {canConfigure ? (
        /*
         * `key` che cambia a ogni salvataggio, e non è un dettaglio.
         *
         * Il modulo è un componente client, e i suoi `useState` prendono il
         * valore iniziale dalle proprietà **solo al primo montaggio**. Dopo una
         * server action la pagina si rivalida ma il componente non si rimonta:
         * senza questa riga i due menu a tendina continuavano a mostrare
         * «Nessuno» dopo aver salvato Jira e Gemini.
         *
         * Non era un difetto estetico. Chi salvava vedeva «Nessuno», pensava
         * che non avesse funzionato, e salvando di nuovo **cancellava davvero**
         * la configurazione appena inserita.
         */
        <SettingsForm
          key={settings.updatedAt.toISOString()}
          slug={project.slug}
          settings={settings}
          custodyReady={custodyReady}
        />
      ) : (
        /*
         * Chi non può cambiare vede lo stato e la ragione, non un modulo spento.
         *
         * Un modulo disabilitato invita a compilarlo e poi rifiuta: dire prima
         * chi può farlo risparmia il tentativo e indica a chi rivolgersi.
         */
        <Card>
          <CardContent className="pt-6 text-sm">
            Solo il proprietario dell&apos;organizzazione o un amministratore può cambiare
            queste impostazioni. Contengono la credenziale con cui l&apos;azienda paga il
            consumo del modello, e la chiave che dà accesso al suo Jira.
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function describeConnector(connector: string | null, ready: boolean): string {
  if (connector === null) {
    return "Nessuna fonte scelta: le schermate resteranno vuote finché non ne indichi una.";
  }

  if (connector === "seed") {
    return "Dati di esempio: un progetto inventato, utile per vedere come funziona il portale.";
  }

  if (connector === "jira") {
    return ready
      ? "Jira Cloud, in sola lettura."
      : "Jira Cloud scelto, ma la configurazione non è completa: mancano dei campi o il token.";
  }

  return "Fonte configurata.";
}

function describeBrain(provider: string): string {
  if (provider === "fake") {
    return (
      "Nessun modello collegato: i numeri restano veri, i testi che li accompagnano sono " +
      "segnaposto. Basta per provare il portale."
    );
  }

  return "La chiave è tua: il consumo lo paghi tu, e puoi cambiare fornitore quando vuoi.";
}
