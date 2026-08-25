import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { formatNumber, formatShortDateTime } from "@/lib/format";

import { loadReports, loadSprints } from "../../scheda";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Resoconti · ${slug} · Scrum Master AI` };
}

/** What the agent has actually produced, and what it has not. */
export default async function ResocontiPage({ params }: PageProps) {
  const { slug } = await params;

  const { latestPerSprint, bySprint } = await loadReports(slug);
  const { closed } = await loadSprints(slug);

  const sprintsWithoutReport = closed.filter((sprint) => !bySprint.has(sprint.id));

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Ogni resoconto è conservato insieme ai numeri su cui si fonda, quindi riletto fra
        mesi dirà ancora le stesse cifre.
      </p>

      {latestPerSprint.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground grid gap-3 pt-6 text-sm">
            <p>Nessun resoconto generato finora.</p>
            <p>
              Si producono da{" "}
              <Link
                href={`/progetti/${slug}/scrum-master`}
                className="hover:text-foreground underline underline-offset-4"
              >
                Cosa può fare
              </Link>
              , scegliendo uno sprint concluso.
            </p>
          </CardContent>
        </Card>
      ) : (
        latestPerSprint.map(({ report, earlier }) => (
          <Card key={report.id} data-report>
            <CardHeader>
              <h2 className="text-base leading-none font-semibold" data-report-sprint>
                {report.snapshot.sprintName}
              </h2>
              <CardDescription>
                {formatShortDateTime(report.generatedAt)} ·{" "}
                {report.origin === "model"
                  ? "narrato da un modello"
                  : report.origin === "stub"
                    ? "testo dimostrativo: nessun modello configurato"
                    : "composto dal codice: non c'era nulla da narrare"}
                {earlier === 0
                  ? ""
                  : earlier === 1
                    ? " · una versione precedente resta nel registro"
                    : ` · ${formatNumber(earlier)} versioni precedenti restano nel registro`}
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4">
              <div className="grid gap-3 text-sm" data-report-prose>
                <p>{report.content.summary}</p>
                <p>{report.content.flow}</p>

                {report.content.attentionPoints.length > 0 ? (
                  <ul className="grid list-disc gap-1 pl-5">
                    {report.content.attentionPoints.map((point) => (
                      <li key={`${point.metricId}-${point.observation.slice(0, 12)}`}>
                        {point.observation}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/*
               * I numeri accanto al testo, non altrove.
               *
               * Chi legge deve poter confrontare senza cambiare pagina: è
               * l'unico modo in cui l'affermazione «le cifre vengono dal
               * codice» diventa qualcosa che si può controllare invece che
               * credere.
               */}
              <div className="grid gap-2 border-t pt-4">
                <h3 className="text-sm font-medium">I numeri su cui si fonda</h3>

                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  {report.snapshot.values.map((value) => (
                    <div
                      key={`${value.metricId}-${value.label}`}
                      className="flex gap-2"
                      data-report-figure
                    >
                      <dt className="text-muted-foreground">{value.label}:</dt>
                      <dd className="font-medium">{value.text}</dd>
                    </div>
                  ))}
                </dl>

                {report.snapshot.gaps.length > 0 ? (
                  <div className="grid gap-1 pt-2">
                    <h3 className="text-sm font-medium">Non calcolabili per questo sprint</h3>
                    <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
                      {report.snapshot.gaps.map((gap) => (
                        <li key={`${gap.metricId}-${gap.label}`}>
                          {gap.label}: {gap.explanation}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {/*
       * Ciò che manca va detto, non lasciato dedurre.
       *
       * Con tre sprint conclusi e un solo resoconto, questa schermata mostrava
       * una scheda sola e sembrava rotta. Non lo era: gli altri due
       * semplicemente non erano mai stati generati. Un elenco che tace le
       * proprie assenze costringe chi legge a chiedersi se il difetto sia nei
       * dati o nella pagina.
       */}
      {sprintsWithoutReport.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {sprintsWithoutReport.length === 1
            ? `${sprintsWithoutReport[0]?.name} è concluso e non ha ancora un resoconto.`
            : `${formatNumber(sprintsWithoutReport.length)} sprint conclusi non hanno ancora un resoconto: ${sprintsWithoutReport
                .map((sprint) => sprint.name)
                .join(", ")}.`}{" "}
          <Link
            href={`/progetti/${slug}/scrum-master`}
            className="hover:text-foreground underline underline-offset-4"
          >
            Si generano da «Cosa può fare»
          </Link>
          , uno alla volta.
        </p>
      ) : null}
    </div>
  );
}
