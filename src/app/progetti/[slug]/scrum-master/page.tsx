import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  metricSnapshotSchema,
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  reportContentSchema,
  reportOriginSchema,
  isKnownSkillKey,
  type SkillRunFailureCause,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent, mayConfigureAgent } from "@/lib/agents/scrum-agent";
import {
  formatCostUsd,
  formatDuration,
  formatNumber,
  formatShortDateTime,
} from "@/lib/format";

import {
  runConfigurationCheckAction,
  runSprintReportAction,
  setSkillEnabledAction,
} from "./actions";
import { AUTONOMY, PERSONA, SKILLS, STATUS } from "./labels";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Scrum Master AI · ${slug} · Scrum Master AI` };
}

const PERSONA_LABELS = PERSONA;
const AUTONOMY_LABELS = AUTONOMY;
const STATUS_LABELS = STATUS;

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

/**
 * How many runs the technical log shows before it stops.
 *
 * The register had grown to eighteen near-identical lines and took up more of
 * the page than everything a reader actually came for. It is a trace, not a
 * feature: the recent ones answer "did it work and what did it cost", and the
 * rest answer nothing anybody was asking.
 */
const RUNS_SHOWN = 5;

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
    sprintId: row.sprintId,
    origin: reportOriginSchema.parse(row.origin),
    content: reportContentSchema.parse(row.content),
    snapshot: metricSnapshotSchema.parse(row.snapshot),
    generatedAt: row.generatedAt,
  }));

  /*
   * Uno sprint, una scheda: la versione più recente.
   *
   * Rigenerare un resoconto ne aggiunge uno nuovo invece di sostituire il
   * precedente (spec §11 Q3), perché cancellare è irreversibile e accumulare
   * no. Mostrarli però tutti riempiva la pagina di schede che raccontano lo
   * stesso sprint con gli stessi numeri: chi legge vede dati duplicati, non una
   * storia. Qui resta l'ultima per sprint e ciascuna dichiara quante versioni
   * precedenti restano conservate, così ciò che non si vede viene comunque
   * detto invece di sparire in silenzio.
   */
  const latestPerSprint: { report: (typeof reports)[number]; earlier: number }[] = [];
  const bySprint = new Map<string, { report: (typeof reports)[number]; earlier: number }>();

  for (const report of reports) {
    // `reports` arriva già dal più recente al più vecchio.
    const seen = bySprint.get(report.sprintId);

    if (seen) {
      seen.earlier += 1;
      continue;
    }

    const entry = { report, earlier: 0 };
    bySprint.set(report.sprintId, entry);
    latestPerSprint.push(entry);
  }

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

  /**
   * Closed sprints that nobody has generated a report for.
   *
   * Named rather than derived inline because the page has to *say* it: with
   * three closed sprints and one report, the section listing what the agent
   * produced showed a single card and read as a fault. It was not one — the
   * other two had simply never been asked for, and until now could not be.
   */
  const sprintsWithoutReport = closedSprints.filter(
    (sprint) => !bySprint.has(sprint.id),
  );

  const canConfigure = mayConfigureAgent(session.role);
  const reportSkillEnabled = agent.enabledSkillKeys.includes("sprint-report");

  return (
    <main className="mx-auto grid max-w-4xl gap-8 px-6 py-12">
      <header className="grid gap-3">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${slug}` },
            { label: "Scrum Master AI" },
          ]}
        />

        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>

          {/*
           * Che cosa sia, prima di qualunque impostazione.
           *
           * La pagina si apriva con «Configurazione», che è la risposta a una
           * domanda che il lettore non ha ancora avuto modo di porsi. Chi arriva
           * qui la prima volta non sa se stia guardando un modello, un servizio
           * o un elenco di preferenze — e senza quella frase ogni riga
           * successiva è un dettaglio di qualcosa di ignoto.
           */}
          <p className="text-sm">
            È lo Scrum Master AI di questo progetto:{" "}
            <strong>legge i numeri già calcolati dal codice e ne scrive una lettura</strong>.
            Non è un modello addestrato — è una configurazione, la memoria di questo
            progetto e un elenco di capacità che si accendono una alla volta.
          </p>
        </div>

        {/*
         * Lo stato con le sue etichette, non quattro parole di fila.
         *
         * Prima diceva «Facilitatore · Osserva · Attivo · lingua it»: quattro
         * valori senza nome, di cui almeno due incomprensibili a chi non ha
         * compilato il modulo di creazione. Le spiegazioni esistevano già in
         * quel modulo e venivano buttate via proprio qui.
         */}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground text-xs">Stato</dt>
            <dd>
              <span className="font-medium">{STATUS_LABELS[agent.status].label}</span>
              <span className="text-muted-foreground">
                {" "}
                — {STATUS_LABELS[agent.status].explanation}
              </span>
            </dd>
          </div>

          <div className="grid gap-0.5">
            <dt className="text-muted-foreground text-xs">Quanto può spingersi</dt>
            <dd>
              <span className="font-medium">
                {AUTONOMY_LABELS[agent.autonomyLevel].label}
              </span>
              <span className="text-muted-foreground">
                {" "}
                — {AUTONOMY_LABELS[agent.autonomyLevel].explanation}
              </span>
            </dd>
          </div>

          <div className="grid gap-0.5">
            <dt className="text-muted-foreground text-xs">Come si pone</dt>
            <dd>
              <span className="font-medium">{PERSONA_LABELS[agent.persona].label}</span>
              <span className="text-muted-foreground">
                {" "}
                — {PERSONA_LABELS[agent.persona].explanation}
              </span>
            </dd>
          </div>

          <div className="grid gap-0.5">
            <dt className="text-muted-foreground text-xs">Lingua in cui scrive</dt>
            <dd className="font-medium">
              {agent.language === "it" ? "Italiano" : agent.language}
            </dd>
          </div>
        </dl>
      </header>

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-medium">Cosa può fare</h2>
          <p className="text-muted-foreground text-sm">
            Ogni capacità si abilita per conto suo. Quelle non ancora costruite sono
            elencate in fondo alla sezione: sono dichiarazioni di intenzione, non
            funzioni nascoste.
          </p>
        </div>

        <Card>
          <CardHeader>
            {/*
             * Un'intestazione vera, non un titolo finto.
             *
             * `CardTitle` rende un `div`: visivamente identico, ma chi naviga
             * saltando di intestazione in intestazione non lo incontra — e il
             * nome della capacità è esattamente ciò che deve poter trovare.
             */}
            <h3 className="text-base leading-none font-semibold">
              {SKILLS["sprint-report"].name}
            </h3>
            <CardDescription>{SKILLS["sprint-report"].produces}</CardDescription>
          </CardHeader>

          <CardContent className="grid gap-3">
            {latestClosed ? (
              <>
                <p className="text-sm">
                  Si genera su uno sprint <strong>concluso</strong>: su uno ancora aperto
                  direbbe al passato numeri destinati a cambiare.
                </p>

                {!canConfigure ? (
                  <p className="text-muted-foreground text-sm">
                    Serve un ruolo di amministratore per generare un resoconto.
                  </p>
                ) : reportSkillEnabled ? (
                  <div className="grid gap-3">
                    {/*
                     * Si sceglie lo sprint, non lo si subisce.
                     *
                     * Prima il comando era legato all'ultimo sprint concluso e
                     * basta: gli altri due chiusi non avevano un resoconto e
                     * non c'era modo di produrlo. La sezione «Cosa ha prodotto»
                     * mostrava così una sola scheda, e sembrava un difetto
                     * invece di un limite dell'interfaccia.
                     *
                     * Il server verifica comunque che lo sprint appartenga al
                     * progetto e sia chiuso, quindi la scelta qui non allarga
                     * ciò che è permesso: rende raggiungibile ciò che già lo era.
                     */}
                    <form
                      action={runSprintReportAction}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="slug" value={slug} />

                      <div className="grid gap-1">
                        <label
                          htmlFor="sprintId"
                          className="text-muted-foreground text-xs"
                        >
                          Sprint concluso
                        </label>
                        <select
                          id="sprintId"
                          name="sprintId"
                          defaultValue={latestClosed.id}
                          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                        >
                          {closedSprints.map((sprint) => (
                            <option key={sprint.id} value={sprint.id}>
                              {sprint.name}
                            </option>
                          ))}
                        </select>
                      </div>

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

        {/*
         * Ciò che non c'è ancora, detto invece che taciuto.
         *
         * Il modello dichiara sei capacità e ne esegue due. Nasconderle
         * lascerebbe credere che il prodotto sia finito qui; mostrarle come
         * pulsanti spenti lascerebbe credere che siano rotte.
         */}
        <Card className="bg-muted/40">
          <CardHeader>
            <h3 className="text-base leading-none font-semibold">Non ancora costruite</h3>
            <CardDescription>
              Sono già nel modello e nel vocabolario del prodotto, ma nessuna di queste
              può essere eseguita in questa versione.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground grid gap-2 text-sm">
              {Object.entries(SKILLS)
                .filter(([, skill]) => !skill.available)
                .map(([key, skill]) => (
                  <li key={key}>
                    <span className="text-foreground font-medium">{skill.name}</span> —{" "}
                    {skill.produces}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-medium">Cosa ha prodotto</h2>
          <p className="text-muted-foreground text-sm">
            Ogni resoconto è conservato insieme ai numeri su cui si fonda, quindi riletto
            fra mesi dirà ancora le stesse cifre.
          </p>

          {/*
           * Ciò che manca va detto, non lasciato dedurre.
           *
           * Con tre sprint conclusi e un solo resoconto, questa sezione
           * mostrava una scheda sola e sembrava rotta. Non lo era: gli altri
           * due semplicemente non erano mai stati generati. Un elenco che tace
           * le proprie assenze costringe chi legge a chiedersi se il difetto
           * sia nei dati o nella pagina.
           */}
          {sprintsWithoutReport.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              {sprintsWithoutReport.length === 1
                ? `${sprintsWithoutReport[0]?.name} è concluso e non ha ancora un resoconto: si genera qui sopra.`
                : `${formatNumber(sprintsWithoutReport.length)} sprint conclusi non hanno ancora un resoconto (${sprintsWithoutReport
                    .map((sprint) => sprint.name)
                    .join(", ")}): si generano qui sopra, uno alla volta.`}
            </p>
          ) : null}
        </div>

        {latestPerSprint.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground pt-6 text-sm">
              Nessun resoconto generato.
            </CardContent>
          </Card>
        ) : (
          latestPerSprint.map(({ report, earlier }) => (
            <Card key={report.id} data-report>
              <CardHeader>
                <h3 className="text-base leading-none font-semibold" data-report-sprint>
                  {report.snapshot.sprintName}
                </h3>
                <CardDescription>
                  {formatShortDateTime(report.generatedAt)} ·{" "}
                  {report.origin === "model"
                    ? "narrato da un modello"
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
                  <h4 className="text-sm font-medium">I numeri su cui si fonda</h4>

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
                      <h4 className="text-sm font-medium">Non calcolabili per questo sprint</h4>
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
        <div className="grid gap-1">
          <h2 className="text-lg font-medium">Com&apos;è configurato</h2>
          <p className="text-muted-foreground text-sm">
            I limiti entro cui lavora. Servono a impedire che una capacità costi più di
            quanto valga, e si vedono qui perché nulla di ciò che spende debba restare
            invisibile.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            {/*
             * Ogni voce con la sua spiegazione, non solo con il suo valore.
             *
             * «Budget di token: quello dichiarato dalla skill» era una risposta
             * a una domanda che il lettore non poteva porsi: nulla nella pagina
             * diceva cosa fosse un token, né perché ci fosse un budget.
             */}
            <dl className="grid gap-4 text-sm">
              <div className="grid gap-0.5">
                <dt className="font-medium">Capacità accese</dt>
                <dd className="text-muted-foreground">
                  {agent.enabledSkillKeys.length === 0
                    ? "Nessuna: lo Scrum Master AI esiste ma non può fare nulla finché non se ne accende una."
                    : agent.enabledSkillKeys
                        .map((key) =>
                          isKnownSkillKey(key)
                            ? SKILLS[key].name
                            : `${key} (non più disponibile in questa versione)`,
                        )
                        .join(", ")}
                </dd>
              </div>

              <div className="grid gap-0.5">
                <dt className="font-medium">
                  Al massimo {formatNumber(agent.policy.maxRunsPerDay)} esecuzioni al giorno
                </dt>
                <dd className="text-muted-foreground">
                  Un tetto giornaliero: oltre questo numero le richieste vengono rifiutate.
                  Esiste perché ogni esecuzione costa, e un difetto che ne innescasse mille
                  se ne accorgerebbe solo la bolletta.
                </dd>
              </div>

              <div className="grid gap-0.5">
                <dt className="font-medium">
                  Budget per esecuzione:{" "}
                  {agent.policy.maxTokensPerRun === null
                    ? "quello che dichiara la capacità stessa"
                    : `${formatNumber(agent.policy.maxTokensPerRun)} token`}
                </dt>
                <dd className="text-muted-foreground">
                  I modelli linguistici si pagano a <em>token</em>, all&apos;incirca dei
                  frammenti di parola: un resoconto ne consuma qualche centinaio. Il budget
                  è il tetto per una singola esecuzione, e superarlo la ferma prima di
                  partire invece che a metà.
                </dd>
              </div>

              {context ? (
                <div className="grid gap-0.5">
                  <dt className="font-medium">
                    Sprint di {formatNumber(context.sprintLengthDays)} giorni
                  </dt>
                  <dd className="text-muted-foreground">
                    La durata abituale degli sprint di questo progetto, usata per capire a
                    che punto sia quello in corso.
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
            <h3 className="text-base leading-none font-semibold">Cosa non farà mai</h3>
            <CardDescription>
              Valgono per ogni Scrum Master AI, non sono configurabili e non esiste un
              modo di spegnerle.
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
        <div className="grid gap-1">
          <h2 className="text-lg font-medium">Diario tecnico</h2>
          <p className="text-muted-foreground text-sm">
            Serve a rispondere a due domande sole: <strong>ha funzionato</strong> e{" "}
            <strong>quanto è costato</strong>. Non c&apos;è niente da fare qui — è una
            traccia, ed è normale non guardarla mai.
          </p>
        </div>

        <Card>
          <CardContent className="grid gap-3 pt-6">
            <p className="text-muted-foreground text-sm">
              <strong className="text-foreground">{SKILLS["configuration-check"].name}</strong>{" "}
              — {SKILLS["configuration-check"].produces}
            </p>

            {canConfigure ? (
              <form action={runConfigurationCheckAction}>
                <input type="hidden" name="slug" value={slug} />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={agent.status === "suspended"}
                >
                  Prova il collegamento
                </Button>
              </form>
            ) : (
              <p className="text-muted-foreground text-sm">
                Serve un ruolo di amministratore per eseguire una verifica.
              </p>
            )}
          </CardContent>
        </Card>

        {runs.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground pt-6 text-sm">
              Nessuna esecuzione finora.
            </CardContent>
          </Card>
        ) : (
          <>
            <ul className="grid gap-2">
              {runs.slice(0, RUNS_SHOWN).map((run) => (
                <li key={run.id} className="rounded-lg border p-3">
                  {/*
                   * L'esito va a capo, la durata resta leggibile: una causa di
                   * fallimento lunga («Il fornitore ha applicato un limite di
                   * frequenza») su schermo stretto spingeva la durata contro il
                   * bordo.
                   */}
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <span className="text-sm font-medium">
                      {isKnownSkillKey(run.skillKey)
                        ? SKILLS[run.skillKey].name
                        : run.skillKey}
                      {" · "}
                      {run.status === "succeeded" ? "riuscita" : "fallita"}
                      {run.failureCause ? ` — ${FAILURE_LABELS[run.failureCause]}` : ""}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {formatDuration(run.durationMs)}
                    </span>
                  </div>

                  <p className="text-muted-foreground mt-1 text-xs">
                    {/*
                     * L'ora, non solo la data.
                     *
                     * Otto verifiche di configurazione dello stesso giorno, con lo
                     * stesso fornitore e lo stesso numero di token, rendevano otto
                     * righe identiche: il registro sembrava mostrare lo stesso
                     * dato ripetuto invece di otto esecuzioni distinte. Le righe
                     * erano diverse; era la data da sola a buttare via ciò che le
                     * distingueva.
                     */}
                    {run.skillKey} · {formatShortDateTime(run.startedAt)} ·{" "}
                    {run.provider === "fake"
                      ? "fornitore fittizio, nessuna chiamata reale"
                      : (run.provider ?? "nessun fornitore")}
                    {run.model && run.provider !== "fake" ? ` (${run.model})` : ""} ·{" "}
                    {formatNumber(run.inputTokens + run.outputTokens)} token ·{" "}
                    {formatCostUsd(run.estimatedCostUsd)}
                  </p>
                </li>
              ))}
            </ul>

            {runs.length > RUNS_SHOWN ? (
              // Ciò che non si vede va detto, non fatto sparire.
              <p className="text-muted-foreground text-xs">
                Vengono mostrate le {formatNumber(RUNS_SHOWN)} esecuzioni più recenti su{" "}
                {formatNumber(runs.length)} conservate.
              </p>
            ) : null}
          </>
        )}
      </section>

      <p className="text-muted-foreground text-xs">
        Il costo è calcolato in codice da un listino versionato nel repository, mai
        prodotto da un modello.
      </p>
    </main>
  );
}
