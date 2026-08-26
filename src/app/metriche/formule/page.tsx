import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { METRIC_CATALOG } from "@/metrics";
import type {
  MetricAggregation,
  MetricDefinition,
  MetricInputEntity,
  MetricObservation,
  MetricOperation,
} from "@/domain";
import { auth } from "@/lib/auth";

/**
 * The formulas: which data goes in, what is done to it, and where it ends.
 *
 * **Why this is a second page and not more of the first one.** `/metriche`
 * answers "what does this number mean", which is what a reader needs to trust a
 * figure. This answers a different question — "how is it obtained" — and putting
 * both on one page makes it too long for the first reader and too vague for the
 * second.
 *
 * The most frequent way to get a duration wrong is not the arithmetic, it is the
 * **ends**: measuring cycle time to the *last* completion instead of the first
 * turns rework into slowness, and both versions read as correct in prose. So the
 * ends are stated in full, and the schema refuses a duration that omits them.
 *
 * Every edge case names the test that proves it, and `catalog.test.ts` checks
 * that the test exists with that name. Without that link this page would be a
 * list of promises about behaviour — and promises about behaviour are exactly
 * what drifts away from the code.
 */

export const metadata: Metadata = {
  title: "Le formule dei calcoli · Scrum Master AI",
};

const ENTITY_LABELS: Readonly<Record<MetricInputEntity, string>> = {
  WorkItem: "Elemento di lavoro",
  StateTransition: "Passaggio di stato",
  EstimateChange: "Variazione di stima",
  WorkingCalendar: "Calendario lavorativo",
  TeamMemberAvailability: "Disponibilità di una persona",
  ImprovementAction: "Azione di miglioramento",
  Sprint: "Sprint",
  SprintScopeEvent: "Movimento di perimetro",
};

/**
 * The operation in words, with what it implies for the reader.
 *
 * A count and a sum are not interchangeable even when both produce «12»: a count
 * stays comparable between teams that estimate differently, a sum does not.
 */
const OPERATION_LABELS: Readonly<Record<MetricOperation, string>> = {
  count: "conteggio — quante cose ci sono",
  sum: "somma — quantità sommate fra loro",
  elapsed: "tempo trascorso — la distanza fra due istanti",
  ratio: "rapporto — una quantità divisa per un'altra dello stesso tipo",
  median: "mediana — il valore di mezzo, non la media",
  mean: "media — la somma divisa per quanti sono",
  series: "serie — un valore campionato più volte nel tempo",
  worst: "il peggiore — deliberatamente non la media",
};

const AGGREGATION_LABELS: Readonly<Record<MetricAggregation, string>> = {
  mean: "media",
  median: "mediana",
  p85: "85° percentile",
};

function observationOf(observation: MetricObservation): {
  readonly title: string;
  readonly body: string;
} {
  switch (observation.kind) {
    case "between":
      return {
        title: "Fra quali due istanti",
        body: `Da ${observation.from} a ${observation.to}.`,
      };
    case "at":
      return { title: "In quale istante", body: `${observation.instant}.` };
    case "history":
      return { title: "Su quale tratto di storia", body: `${observation.over}.` };
  }
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="text-muted-foreground text-sm">{children}</div>
    </div>
  );
}

function FormulaEntry({ metric }: { readonly metric: MetricDefinition }) {
  const observation = observationOf(metric.observation);

  return (
    <Card id={metric.id}>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-medium">{metric.name}</h2>
          <p className="text-muted-foreground text-sm">{metric.question}</p>
        </div>

        <Row label="Da quali dati parte">
          <ul className="grid gap-1">
            {metric.inputs.map((input) => (
              <li key={`${input.entity}-${input.reads}`}>
                <span className="text-foreground font-medium">{ENTITY_LABELS[input.entity]}</span>
                : {input.reads}
              </li>
            ))}
          </ul>
        </Row>

        <Row label={observation.title}>{observation.body}</Row>


        <Row label="Che operazione applica">
          {OPERATION_LABELS[metric.operation]}
          {metric.summarisedBy.length > 0 ? (
            <>
              {". "}
              Il valore è calcolato per singolo elemento e poi riassunto come{" "}
              {metric.summarisedBy.map((how) => AGGREGATION_LABELS[how]).join(", ")}.
            </>
          ) : null}
        </Row>

        {metric.referenceInstant ? (
          <Row label="Rispetto a quale momento">
            {metric.referenceInstant}
            <span className="mt-1 block text-xs">
              L&apos;istante arriva dall&apos;esterno e non viene mai letto dall&apos;orologio:
              altrimenti lo stesso calcolo darebbe un risultato diverso a ogni esecuzione, e
              nessun test potrebbe dire quale sia quello giusto.
            </span>
          </Row>
        ) : null}

        <Row label="Cosa conta la numerosità che accompagna il valore">
          {metric.sampleSizeMeaning}
        </Row>

        <div className="grid gap-2 border-t pt-4">
          <h3 className="text-sm font-medium">Casi limite, e cosa restituisce davvero</h3>

          <dl className="grid gap-3 text-sm">
            {metric.edgeCases.map((edgeCase) => (
              <div key={edgeCase.situation} className="grid gap-0.5">
                <dt className="text-foreground">{edgeCase.situation}</dt>
                <dd className="text-muted-foreground">{edgeCase.outcome}</dd>
                <dd className="text-muted-foreground text-xs">
                  Verificato dal test «{edgeCase.verifiedBy}»
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-muted-foreground border-t pt-3 text-xs">
          <code className="font-mono">
            {metric.sourceFile} · {metric.sourceSymbol}
          </code>{" "}
          — verificata in <code className="font-mono">{metric.testFile}</code>
        </p>
      </CardContent>
    </Card>
  );
}

export default async function FormulePage() {
  // Nessun dato aziendale, ma resta nell'area riservata come `/metriche`: è
  // documentazione del prodotto, non materiale pubblico.
  const session = await auth();
  if (!session) redirect("/accedi");

  return (
    <main className="app-shell grid gap-8 py-8">
      <div className="grid gap-3">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: "Metriche", href: "/metriche" },
            { label: "Formule" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight">Le formule dei calcoli</h1>

        <p className="text-muted-foreground max-w-2xl text-sm">
          Qui c&apos;è il passaggio intermedio: da quali dati parte ogni metrica, fra quali
          istanti misura, che operazione applica e cosa restituisce nei casi difficili.{" "}
          <Link href="/metriche" className="underline underline-offset-4">
            L&apos;altra pagina
          </Link>{" "}
          risponde invece alla domanda su cosa significhi un numero.
        </p>

        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm">
            <h2 className="font-medium">Perché gli estremi sono scritti per esteso</h2>
            <p className="text-muted-foreground">
              Il modo più frequente di sbagliare una durata non è l&apos;aritmetica: sono gli
              estremi. Misurare il cycle time fino all&apos;<em>ultima</em> chiusura invece che
              alla prima fa sembrare più lenta una consegna che è stata soltanto rilavorata — e
              raccontate a parole le due versioni sembrano entrambe corrette.
            </p>
            <p className="text-muted-foreground">
              Per questo ogni durata dichiara i suoi due estremi, e lo schema si rifiuta di
              caricare una metrica che non li dichiari. Non è una convenzione di scrittura: è un
              controllo che fallisce.
            </p>
          </CardContent>
        </Card>
      </div>

      <nav aria-label="Elenco delle formule" className="grid gap-2">
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
          <FormulaEntry key={metric.id} metric={metric} />
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-2 pt-6 text-sm">
          <h2 className="font-medium">Come si legge un caso limite</h2>
          <p className="text-muted-foreground">
            Ogni caso limite dice cosa il codice restituisce <em>davvero</em>, e cita il test che
            lo dimostra. Il nome del test non è un riferimento di cortesia: un controllo verifica
            che quel test esista con quel nome, e fallisce se qualcuno lo rinomina o lo cancella.
          </p>
          <p className="text-muted-foreground">
            Senza quel legame questa pagina sarebbe un elenco di promesse sul comportamento del
            codice — ed è esattamente ciò che, col tempo, smette di corrispondere al codice.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
