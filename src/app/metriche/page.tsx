import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { METRIC_CATALOG } from "@/metrics";
import type { MetricDefinition, MetricUnit } from "@/domain";
import { auth } from "@/lib/auth";

/**
 * The metrics catalogue: what every number on the dashboard means.
 *
 * **Why it exists.** R1 says the code calculates and the model narrates. Until
 * now the only way to check that claim was to read TypeScript, which puts the
 * claim out of reach of the person it most needs to convince. A number nobody
 * can audit has to be taken on trust, and a dashboard that has to be trusted is
 * a dashboard that will eventually be believed when it is wrong.
 *
 * It renders `METRIC_CATALOG`, which is validated data next to the engine, not
 * prose written here. A test walks the engine and fails when a metric has no
 * entry, so this page cannot quietly fall behind the code it describes.
 */

export const metadata: Metadata = {
  title: "Come si calcolano le metriche · Scrum Master AI",
};

const UNIT_LABELS: Readonly<Record<MetricUnit, string>> = {
  duration: "durata",
  count: "conteggio",
  ratio: "percentuale",
  points: "unità di stima",
  "items-per-sprint": "elementi",
  verdict: "giudizio",
};

function MetricEntry({ metric }: { readonly metric: MetricDefinition }) {
  return (
    <Card id={metric.id}>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-medium">{metric.name}</h2>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {UNIT_LABELS[metric.unit]}
            </span>
          </div>
          <p className="text-muted-foreground text-sm">{metric.question}</p>
        </div>

        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Come si calcola</h3>
          <p className="text-sm">{metric.formula}</p>
        </div>

        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Cosa non conta</h3>
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
            {metric.excludes.map((exclusion) => (
              <li key={exclusion}>{exclusion}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Quando non è calcolabile</h3>
          {/*
           * Sta accanto alla formula e non in fondo perché è parte della
           * definizione: una metrica che in mancanza di dati stampasse `0`
           * mostrerebbe uno sprint vuoto e uno disastroso con lo stesso numero.
           */}
          <p className="text-muted-foreground text-sm">{metric.unavailableWhen}</p>
        </div>

        {metric.decision ? (
          <div className="grid gap-1 border-l-2 pl-4">
            <h3 className="text-sm font-medium">Perché è definita così</h3>
            <p className="text-muted-foreground text-sm">{metric.decision}</p>
          </div>
        ) : null}

        <p className="text-muted-foreground border-t pt-3 text-xs">
          Calcolata in{" "}
          <code className="font-mono">
            {metric.sourceFile} · {metric.sourceSymbol}
          </code>
          , verificata in <code className="font-mono">{metric.testFile}</code>
        </p>
      </CardContent>
    </Card>
  );
}

export default async function MetrichePage() {
  // Non ci sono dati di alcuna azienda in questa pagina, ma resta dentro
  // l'area riservata: è documentazione del prodotto, non materiale pubblico.
  const session = await auth();
  if (!session) redirect("/accedi");

  return (
    <main className="app-shell grid gap-8 py-8">
      <div className="grid gap-3">
        <Breadcrumb trail={[{ label: "Progetti", href: "/progetti" }, { label: "Metriche" }]} />

        <h1 className="text-2xl font-semibold tracking-tight">Come si calcolano le metriche</h1>

        <p className="text-muted-foreground max-w-2xl text-sm">
          Ogni numero mostrato dall&apos;applicazione è prodotto da codice deterministico e
          testato. Nessuno è prodotto da un modello linguistico: il modello riceve i numeri già
          calcolati e li racconta. Questa pagina esiste perché quell&apos;affermazione si possa
          controllare senza leggere il codice.
        </p>

        {/*
         * Il rimando alla pagina delle formule.
         *
         * Una pagina raggiungibile solo scrivendo l'indirizzo a mano è un vicolo
         * cieco, ed è già successo una volta in questo progetto: `/organizzazione`
         * annunciava che i progetti sarebbero arrivati mentre esistevano già, e
         * non offriva alcun collegamento.
         */}
        <p className="text-sm">
          <Link href="/metriche/formule" className="underline underline-offset-4">
            Le formule dei calcoli
          </Link>{" "}
          <span className="text-muted-foreground">
            — da quali dati parte ogni metrica, fra quali istanti misura e cosa restituisce nei
            casi difficili.
          </span>
        </p>
      </div>

      <nav aria-label="Elenco delle metriche" className="grid gap-2">
        <h2 className="text-sm font-medium">Le {METRIC_CATALOG.length} metriche</h2>
        <ul className="flex flex-wrap gap-2">
          {METRIC_CATALOG.map((metric) => (
            <li key={metric.id}>
              <a
                href={`#${metric.id}`}
                className="bg-secondary text-secondary-foreground hover:bg-secondary/70 inline-flex min-h-9 items-center rounded-md px-3 text-sm"
              >
                {metric.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-4">
        {METRIC_CATALOG.map((metric) => (
          <MetricEntry key={metric.id} metric={metric} />
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm">
          <h2 className="font-medium">Cosa non viene misurato, e per scelta</h2>
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5">
            <li>
              Nessuna metrica di prestazione individuale: niente velocity per persona, niente
              conteggi di commit, nessuna classifica. Si misura il processo, non le persone.
            </li>
            <li>
              Nessuna deduzione sullo stato d&apos;animo di qualcuno. Nel contesto lavorativo
              europeo è una pratica vietata, e un indicatore di clima si ricava semmai da segnali
              di processo aggregati.
            </li>
            <li>
              Ogni valore è accompagnato dal numero di osservazioni su cui poggia: un cycle time
              su due elementi e uno su duecento non meritano la stessa fiducia.
            </li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
