import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  metricSnapshotSchema,
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  reportContentSchema,
  reportOriginSchema,
  type AgentPersona,
  type AgentStatus,
  type AutonomyLevel,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent, mayConfigureAgent } from "@/lib/agents/scrum-agent";
import { formatCostUsd, formatDate, formatDuration, formatNumber } from "@/lib/format";

import {
  runConfigurationCheckAction,
  runSprintReportAction,
  setSkillEnabledAction,
} from "./actions";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Scrum Master AI · ${slug} · Scrum Master AI` };
}

const PERSONA_LABELS: Readonly<Record<AgentPersona, string>> = {
  facilitator: "Facilitatore",
  flow_analyst: "Analista di flusso",
  stakeholder_communicator: "Comunicatore verso stakeholder",
};

const AUTONOMY_LABELS: Readonly<Record<AutonomyLevel, string>> = {
  observe: "Osserva",
  report: "Riferisce",
  advise: "Consiglia",
  act_with_approval: "Agisce con approvazione",
  autonomous: "Autonomo",
};

const STATUS_LABELS: Readonly<Record<AgentStatus, string>> = {
  active: "Attivo",
  suspended: "Sospeso",
};

/**
 * Every failure says what happened **and what to do about it**.
 *
 * A cause code alone — `provider_not_configured` — is a fact about the system,
 * not help for the person reading it. The spec asks for both.
 */
const FAILURE_LABELS: Readonly<Record<SkillRunFailureCause, string>> = {
  budget_exceeded: "Richiesta oltre il budget di token",
  quota_exceeded: "Limite giornaliero di esecuzioni raggiunto",
  provider_not_configured: "Nessun fornitore configurato",
  provider_unavailable: "Il fornitore non ha risposto",
  rate_limited: "Il fornitore ha applicato un limite di frequenza",
  timeout: "Il fornitore non ha risposto in tempo",
  invalid_output: "La risposta non rispettava il formato atteso",
  agent_suspended: "Lo Scrum Master AI è sospeso",
};

export default async function ScrumMasterPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) notFound();

  const project = projectSchema.parse(projectRow);
  const projectId = projectIdSchema.parse(project.id);

  const loaded = await loadAgent(organizationId, projectId);
  if (!loaded) redirect(`/progetti/${slug}/scrum-master/crea`);

  const { agent, context } = loaded;
  const [runs, reportRows, sprintRows] = await Promise.all([
    scope.reads.skillRunsByProject(projectId),
    scope.reads.sprintReportsByProject(projectId),
    scope.reads.sprintsByProject(projectId),
  ]);

  const reports = reportRows.map((row) => ({
    id: row.id,
    origin: reportOriginSchema.parse(row.origin),
    content: reportContentSchema.parse(row.content),
    snapshot: metricSnapshotSchema.parse(row.snapshot),
    generatedAt: row.generatedAt,
  }));

  /*
   * Only closed sprints can be reported on.
   *
   * The most recently closed one is offered, because it is the one a team asks
   * about. Choosing among them is a control this screen does not need yet, and
   * an empty dropdown is worse than a disabled button that says why.
   */
  const closedSprints = sprintRows
    .filter((sprint) => sprint.completedAt !== null)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());

  const latestClosed = closedSprints[0];

  const canConfigure = mayConfigureAgent(session.role);
  const reportSkillEnabled = agent.enabledSkillKeys.includes("sprint-report");

  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-6 py-12">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${slug}` },
            { label: "Scrum Master AI" },
          ]}
        />

        <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>

        <p className="text-muted-foreground text-sm">
          {PERSONA_LABELS[agent.persona]} · {AUTONOMY_LABELS[agent.autonomyLevel]} ·{" "}
          {STATUS_LABELS[agent.status]} · lingua {agent.language}
        </p>
      </header>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Configurazione</h2>

        <Card>
          <CardContent className="pt-6">
            {/*
             * Un elenco di definizioni, non righe con `justify-between`.
             *
             * Affiancare etichetta e valore funziona finché il valore è corto:
             * «quello dichiarato dalla skill» su schermo stretto veniva
             * schiacciato contro il bordo. Impilati sotto i 640 pixel e
             * affiancati sopra, entrambi restano leggibili — e un `dl` dice a
             * un lettore di schermo che sono coppie, cosa che due `span`
             * affiancati non dicono.
             */}
            <dl className="grid gap-3 text-sm">
              <div className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                <dt className="text-muted-foreground">Skill abilitate</dt>
                <dd className="sm:text-right">
                  {agent.enabledSkillKeys.length === 0
                    ? "nessuna"
                    : agent.enabledSkillKeys.join(", ")}
                </dd>
              </div>

              <div className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                <dt className="text-muted-foreground">Esecuzioni al giorno</dt>
                <dd className="tabular-nums sm:text-right">
                  {formatNumber(agent.policy.maxRunsPerDay)}
                </dd>
              </div>

              <div className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                <dt className="text-muted-foreground">Budget di token</dt>
                <dd className="tabular-nums sm:text-right">
                  {agent.policy.maxTokensPerRun === null
                    ? "quello dichiarato dalla skill"
                    : formatNumber(agent.policy.maxTokensPerRun)}
                </dd>
              </div>

              {context ? (
                <div className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:gap-4">
                  <dt className="text-muted-foreground">Durata dello sprint</dt>
                  <dd className="tabular-nums sm:text-right">
                    {formatNumber(context.sprintLengthDays)} giorni
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        {/*
         * I divieti si vedono ma non si toccano.
         *
         * Mostrarli come impostazioni disattivabili suggerirebbe che si possano
         * spegnere; nasconderli lascerebbe credere che siano una dimenticanza.
         */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vincoli non disattivabili</CardTitle>
            <CardDescription>
              Valgono per ogni Scrum Master AI e non sono configurabili.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground grid gap-1 text-sm">
              <li>Nessuna valutazione delle singole persone, nessuna classifica.</li>
              <li>Nessuna deduzione sullo stato d&apos;animo di un individuo.</li>
              <li>
                Il testo proveniente dalle fonti è un dato da leggere, mai un&apos;istruzione
                da eseguire.
              </li>
              <li>I numeri sono calcolati in codice: il modello li racconta, non li produce.</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Verifica della configurazione</h2>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            <p className="text-muted-foreground text-sm">
              Esegue una chiamata reale attraverso il gateway e ne registra l&apos;esito. Non
              legge dati di progetto: serve solo a dimostrare che gateway e registro
              funzionano.
            </p>

            {canConfigure ? (
              <form action={runConfigurationCheckAction}>
                <input type="hidden" name="slug" value={slug} />
                <Button type="submit" disabled={agent.status === "suspended"}>
                  Verifica configurazione
                </Button>
              </form>
            ) : (
              <p className="text-muted-foreground text-sm">
                Serve un ruolo di amministratore per eseguire una verifica.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Resoconto di sprint</h2>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            {latestClosed ? (
              <>
                <p className="text-muted-foreground text-sm">
                  Genera il resoconto di <strong>{latestClosed.name}</strong>, l&apos;ultimo
                  sprint concluso. I numeri sono calcolati dal codice: il modello li racconta e
                  non può citarne altri.
                </p>

                {!canConfigure ? (
                  <p className="text-muted-foreground text-sm">
                    Serve un ruolo di amministratore per generare un resoconto.
                  </p>
                ) : reportSkillEnabled ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={runSprintReportAction}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="sprintId" value={latestClosed.id} />
                      <Button type="submit" disabled={agent.status === "suspended"}>
                        Genera il resoconto
                      </Button>
                    </form>

                    <form action={setSkillEnabledAction}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="skillKey" value="sprint-report" />
                      <input type="hidden" name="enable" value="0" />
                      <Button type="submit" variant="outline">
                        Disabilita la skill
                      </Button>
                    </form>
                  </div>
                ) : (
                  <>
                    {/*
                     * La configurazione viene rispettata, non decorata: se la
                     * skill non è abilitata il comando non c'è, e al suo posto
                     * c'è il modo di abilitarla. Un pulsante che fallisse
                     * dicendo «non abilitata» sposterebbe sull'utente il compito
                     * di indovinare dove si abilita.
                     */}
                    <p className="text-muted-foreground text-sm">
                      Il resoconto di sprint non è fra le skill abilitate su questo Scrum Master
                      AI.
                    </p>

                    <form action={setSkillEnabledAction}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="skillKey" value="sprint-report" />
                      <input type="hidden" name="enable" value="1" />
                      <Button type="submit">Abilita il resoconto di sprint</Button>
                    </form>
                  </>
                )}
              </>
            ) : (
              /*
               * Il motivo scritto, non solo un pulsante grigio. Un comando
               * disattivato senza spiegazione lascia chi legge a indovinare se
               * manchi un permesso, un dato o se sia rotto qualcosa.
               */
              <p className="text-muted-foreground text-sm">
                Nessuno sprint concluso: il resoconto di fine sprint si può generare solo su uno
                sprint chiuso, perché su uno ancora aperto direbbe al passato numeri destinati a
                cambiare.
              </p>
            )}
          </CardContent>
        </Card>

        {reports.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground pt-6 text-sm">
              Nessun resoconto generato.
            </CardContent>
          </Card>
        ) : (
          reports.map((report) => (
            <Card key={report.id} data-report>
              <CardHeader>
                <CardTitle className="text-base" data-report-sprint>
                  {report.snapshot.sprintName}
                </CardTitle>
                <CardDescription>
                  {formatDate(report.generatedAt)} ·{" "}
                  {report.origin === "model"
                    ? "narrato da un modello"
                    : "composto dal codice: non c'era nulla da narrare"}
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
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Registro delle esecuzioni</h2>

        {runs.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground pt-6 text-sm">
              Nessuna esecuzione: prova la verifica di configurazione.
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-2">
            {runs.map((run) => (
              <li key={run.id} className="rounded-lg border p-3">
                {/*
                 * L'esito va a capo, la durata resta leggibile: una causa di
                 * fallimento lunga («Il fornitore ha applicato un limite di
                 * frequenza») su schermo stretto spingeva la durata contro il
                 * bordo.
                 */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="text-sm font-medium">
                    {run.status === "succeeded" ? "Riuscita" : "Fallita"}
                    {run.failureCause ? ` — ${FAILURE_LABELS[run.failureCause]}` : ""}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatDuration(run.durationMs)}
                  </span>
                </div>

                <p className="text-muted-foreground mt-1 text-xs">
                  {run.skillKey} · {formatDate(run.startedAt)} ·{" "}
                  {run.provider ?? "nessun fornitore"}
                  {run.model ? ` (${run.model})` : ""} ·{" "}
                  {formatNumber(run.inputTokens + run.outputTokens)} token ·{" "}
                  {formatCostUsd(run.estimatedCostUsd)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-muted-foreground text-xs">
        Il costo è calcolato in codice da un listino versionato nel repository, mai
        prodotto da un modello.
      </p>
    </main>
  );
}
