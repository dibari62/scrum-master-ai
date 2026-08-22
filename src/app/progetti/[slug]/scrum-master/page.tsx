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
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  type AgentPersona,
  type AgentStatus,
  type AutonomyLevel,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent, mayConfigureAgent } from "@/lib/agents/scrum-agent";
import { formatCostUsd, formatDate, formatDuration, formatNumber } from "@/lib/format";

import { runConfigurationCheckAction } from "./actions";

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
  const runs = await scope.reads.skillRunsByProject(projectId);

  const canConfigure = mayConfigureAgent(session.role);

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
