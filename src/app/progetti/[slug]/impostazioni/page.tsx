import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { connectorReady, providerNeedsKey } from "@/domain";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/format";

import { loadSettings } from "./data";
import { IdentityForm } from "./identity-form";
import { SettingsSections } from "./sections";
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
 * Le impostazioni di un progetto, in tre domande.
 *
 * «Come si chiama», «da dove arrivano i dati», «chi scrive i testi». Tre schede
 * e non un unico modulo lungo: con una ventina di campi di fila si ricrea
 * esattamente il difetto già segnalato sulla dashboard — si scorre in basso per
 * scoprire che cosa esiste, e un elenco che si scopre scorrendo è un elenco che
 * nessuno legge fino in fondo.
 *
 * Le tre schede salvano **separatamente**: correggere un refuso nel nome non
 * deve rimandare anche la configurazione di Jira, che è la strada per cambiare
 * qualcosa senza volerlo.
 *
 * ADR-0010: la chiave del modello la porta chi usa il portale. Noi la custodiamo
 * cifrata e non la restituiamo mai a un browser — nemmeno a chi l'ha inserita.
 */
export default async function ImpostazioniPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const query = await searchParams;
  const saved = query["salvato"] === "1";
  const sezione = typeof query["sezione"] === "string" ? query["sezione"] : undefined;
  const view = await loadSettings(slug);

  if (!view) notFound();

  const { project, settings, canConfigure, custodyReady } = view;

  const dataReady = connectorReady({
    connector: settings.connector,
    connectorConfig: settings.connectorConfig,
    connectorSecret: settings.connectorSecret.configured ? "v1.x.y.z" : null,
  });

  const brainReadyNow =
    !providerNeedsKey(settings.brainProvider) || settings.brainApiKey.configured;

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
          Come questo progetto si chiama, da dove prende i dati e con quale modello li
          racconta.
        </p>
      </header>

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
        <SettingsSections
          key={settings.updatedAt.toISOString()}
          initial={sezione}
          sections={[
            {
              id: "anagrafica",
              label: "Anagrafica",
              hint: project.status === "archived" ? "archiviato" : "attivo",
              content: <IdentityForm project={project} />,
            },
            {
              id: "dati",
              label: "Dati",
              hint: describeConnectorShort(settings.connector, dataReady, settings.lastSyncedAt),
              content: (
                <SettingsForm
                  slug={project.slug}
                  settings={settings}
                  custodyReady={custodyReady}
                  sezione="dati"
                />
              ),
            },
            {
              id: "modello",
              label: "Modello",
              hint: describeBrainShort(settings.brainProvider, brainReadyNow),
              content: (
                <SettingsForm
                  slug={project.slug}
                  settings={settings}
                  custodyReady={custodyReady}
                  sezione="modello"
                />
              ),
            },
          ]}
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

/**
 * Lo stato in due o tre parole, per la linguetta della scheda.
 *
 * Corto per forza: è ciò che permette di sapere che cosa manca **senza** aprire
 * ogni scheda — cioè la ragione per cui le schede non ricreano il problema che
 * risolvono. Una frase intera su una linguetta non si legge.
 */
function describeConnectorShort(
  connector: string | null,
  ready: boolean,
  lastSyncedAt: Date | null,
): string {
  if (connector === null) return "nessuna fonte";
  if (connector === "seed") return "dati di esempio";
  if (!ready) return "configurazione incompleta";

  return lastSyncedAt ? `letto il ${formatDate(lastSyncedAt)}` : "mai letto";
}

function describeBrainShort(provider: string, ready: boolean): string {
  if (provider === "fake") return "nessuno";
  if (!ready) return "manca la chiave";

  return provider;
}