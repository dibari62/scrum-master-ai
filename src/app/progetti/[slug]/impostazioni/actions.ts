"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { organizationIdSchema, projectIdSchema } from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { readProjectSettings, writeProjectSettings } from "@/db/project-settings";
import { auth } from "@/lib/auth";
import { gatewayForProject, modelProbeForProject } from "@/lib/agents/project-gateway";
import { checkModel } from "@/lib/projects/model-check";
import {
  mayConfigureSettings,
  parseCalendarForm,
  parseIdentityForm,
  parseSettingsForm,
  submittedValues,
} from "@/lib/projects/settings";
import { describeReport, synchroniseProject } from "@/lib/projects/sync";
import { secretsAvailable } from "@/lib/secrets";

/**
 * Salvataggio delle impostazioni di un progetto.
 *
 * Sottile per scelta: ogni decisione sta in `src/lib/projects/settings.ts`, che
 * è fatto di funzioni normali e quindi verificabile. Una server action non può
 * essere chiamata da un test — il suo identificativo nasce in fase di build —
 * quindi ciò che conta non deve vivere qui.
 *
 * L'organizzazione arriva dalla sessione e il progetto dall'indirizzo. Nessuno
 * dei due si legge mai dal modulo: un corpo di richiesta che potesse nominare
 * un'organizzazione è la forma esatta del difetto che §8.4 esiste per impedire.
 */

export type SettingsFormState =
  | { readonly status: "idle" }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fields: Readonly<Record<string, string>>;
      /**
       * Ciò che era stato scritto, per non farlo perdere.
       *
       * **Trovato provando, non da un test.** Sbagliare un campo su otto
       * svuotava gli altri sette: il modulo non è controllato, quindi un
       * ri-render dopo l'azione ripristinava i valori del server — che per una
       * configurazione mai salvata sono vuoti. Chi aveva appena generato un
       * token su Atlassian e compilato la board doveva ricominciare.
       *
       * **I segreti non tornano mai indietro**, e non è una svista: un `value`
       * in un `input` finisce nell'HTML che il browser riceve, quindi
       * rimandarlo sarebbe la stessa fuga che la cifratura evita, fatta un
       * livello più in là. Se ne perde uno, e la schermata lo dice invece di
       * lasciarlo scoprire al salvataggio successivo.
       */
      readonly values?: Readonly<Record<string, string>>;
      /** Se fra i campi persi c'era una credenziale, così si può dirlo. */
      readonly secretLost?: boolean;
    };

/**
 * L'esito di una lettura.
 *
 * Distinto da `SettingsFormState` perché non ha campi: un errore di
 * sincronizzazione non si attacca a una casella del modulo, riguarda l'intera
 * operazione. Riusare l'altro tipo avrebbe portato un `fields` sempre vuoto,
 * cioè una promessa che nessuno mantiene.
 */
export type SyncFormState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "done"; readonly message: string; readonly at: string };

/**
 * L'esito di una prova di connessione al modello.
 *
 * `skipped` è uno stato a sé e non un errore: il fornitore dimostrativo non ha
 * un collegamento da provare, e chiamarlo fallimento suggerirebbe che ci sia
 * qualcosa da riparare in una scelta perfettamente legittima.
 */
export type ModelTestState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "skipped"; readonly message: string }
  | { readonly status: "done"; readonly message: string; readonly reply: string };

export async function saveSettingsAction(
  _previous: SettingsFormState,
  form: FormData,
): Promise<SettingsFormState> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "error", message: "Progetto non indicato.", fields: {} };
  }

  /*
   * Il controllo del ruolo si rifà qui, anche se la pagina nasconde il modulo.
   *
   * Un pulsante nascosto non è un'autorizzazione: l'azione è raggiungibile da
   * chiunque possa inviarle una richiesta. E qui il danno non sarebbe estetico —
   * queste impostazioni contengono la chiave con cui un'azienda paga.
   */
  if (!mayConfigureSettings(session.role)) {
    return {
      status: "error",
      message: "Solo il proprietario o un amministratore può cambiare le impostazioni.",
      fields: {},
    };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) {
    return { status: "error", message: "Progetto non trovato.", fields: {} };
  }

  const parsed = parseSettingsForm(form);
  if (!parsed.ok) {
    const fields: Record<string, string> = {};
    for (const error of parsed.errors) fields[error.field] = error.message;

    const submitted = submittedValues(form);

    return {
      status: "error",
      message: "Alcuni campi non vanno bene. Sono segnalati qui sotto.",
      fields,
      values: submitted.values,
      secretLost: submitted.secretLost,
    };
  }

  /*
   * Senza chiave principale non si accetta un segreto, e lo si dice **prima**.
   *
   * Salvare tutto il resto e perdere in silenzio la chiave sarebbe il peggior
   * esito possibile: la persona è appena andata a prenderla sul sito del
   * fornitore, la schermata direbbe «salvato», e la prima esecuzione fallirebbe
   * per una ragione che non ha nulla a che vedere con quello che ha fatto.
   */
  const bringsSecret =
    typeof parsed.input.connectorSecret === "string" ||
    typeof parsed.input.brainApiKey === "string";

  if (bringsSecret && !secretsAvailable()) {
    const submitted = submittedValues(form);

    return {
      status: "error",
      message:
        "Questa installazione non ha una chiave di custodia (SECRETS_KEY), " +
        "quindi non può conservare credenziali in modo sicuro. Le altre impostazioni " +
        "si salvano lo stesso: togli la credenziale e riprova.",
      fields: {},
      values: submitted.values,
      secretLost: submitted.secretLost,
    };
  }

  await writeProjectSettings(
    organizationId,
    projectIdSchema.parse(project.id),
    parsed.input,
    new Date(),
  );

  // La pagina del progetto dice con che cosa è collegato e con quale modello
  // pensa: senza questo continuerebbe a mostrare la configurazione precedente.
  revalidatePath(`/progetti/${slug}`);
  revalidatePath(`/progetti/${slug}/impostazioni`);

  /*
   * La conferma la dà il server, non uno stato del componente.
   *
   * Il modulo si **rimonta** dopo un salvataggio — è così che i menu a tendina
   * mostrano i valori appena scritti invece di quelli di prima — e un
   * rimontaggio azzera lo stato di `useActionState` insieme al messaggio. Detto
   * dal server, «salvato» sopravvive al rimontaggio perché non vive lì dentro.
   *
   * Gli **errori** restano invece nello stato del componente, e devono: in caso
   * di errore non si salva nulla, quindi il modulo non si rimonta e il messaggio
   * resta accanto ai campi che l'hanno causato.
   *
   * **La scheda torna nell'indirizzo, e solo qui.** Lo stesso rimontaggio
   * riporterebbe altrimenti alla prima scheda: chi ha appena salvato la
   * configurazione di Jira si ritroverebbe sull'anagrafica, senza aver chiesto
   * di andarci. Il resto del tempo la scheda scelta resta nel browser, dov'è
   * giusto che stia.
   */
  const sezione = form.get("sezione");
  const dove = typeof sezione === "string" ? `&sezione=${sezione}` : "";

  redirect(`/progetti/${slug}/impostazioni?salvato=1${dove}`);
}

/**
 * Salvataggio dell'anagrafica: nome, descrizione, stato.
 *
 * Un'azione separata da quella delle impostazioni tecniche, e la separazione non
 * è estetica: sono due moduli, e un modulo solo obbligherebbe chi corregge un
 * refuso nel nome a rimandare anche la configurazione di Jira — che è la strada
 * per cambiare qualcosa senza volerlo.
 */
export async function saveIdentityAction(
  _previous: SettingsFormState,
  form: FormData,
): Promise<SettingsFormState> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "error", message: "Progetto non indicato.", fields: {} };
  }

  if (!mayConfigureSettings(session.role)) {
    return {
      status: "error",
      message: "Solo il proprietario o un amministratore può cambiare l'anagrafica.",
      fields: {},
    };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) {
    return { status: "error", message: "Progetto non trovato.", fields: {} };
  }

  const parsed = parseIdentityForm(form);
  if (!parsed.ok) {
    const fields: Record<string, string> = {};
    for (const error of parsed.errors) fields[error.field] = error.message;

    return { status: "error", message: "Alcuni campi non vanno bene.", fields };
  }

  await scope.writes.updateProject(projectIdSchema.parse(project.id), parsed.input);

  /*
   * Anche l'elenco dei progetti, non solo questo progetto.
   *
   * Nome, descrizione e stato compaiono **là**, ed è là che si nota se una
   * modifica non ha avuto effetto. Rivalidare solo la pagina corrente
   * mostrerebbe il valore nuovo qui e quello vecchio nell'elenco, che è il modo
   * più efficace di far dubitare del salvataggio.
   */
  revalidatePath("/progetti");
  revalidatePath(`/progetti/${slug}`);
  revalidatePath(`/progetti/${slug}/impostazioni`);

  redirect(`/progetti/${slug}/impostazioni?salvato=1&sezione=anagrafica`);
}

/**
 * Salvataggio del calendario lavorativo.
 *
 * Azione a sé, come le altre due: chi corregge una festività non deve rimandare
 * anche la configurazione di Jira.
 */
export async function saveCalendarAction(
  _previous: SettingsFormState,
  form: FormData,
): Promise<SettingsFormState> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "error", message: "Progetto non indicato.", fields: {} };
  }

  if (!mayConfigureSettings(session.role)) {
    return {
      status: "error",
      message: "Solo il proprietario o un amministratore può cambiare il calendario.",
      fields: {},
    };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) {
    return { status: "error", message: "Progetto non trovato.", fields: {} };
  }

  const parsed = parseCalendarForm(form);
  if (!parsed.ok) {
    const fields: Record<string, string> = {};
    for (const error of parsed.errors) fields[error.field] = error.message;

    return { status: "error", message: "Il calendario non va bene.", fields };
  }

  const projectId = projectIdSchema.parse(project.id);
  const updated = await scope.writes.setWorkingCalendar(projectId, parsed.calendar);

  if (updated.length === 0) {
    /*
     * Nessuna riga aggiornata: il progetto non ha un contesto.
     *
     * Succede quando lo Scrum Master AI non è mai stato creato — il contesto
     * nasce con lui. Dirlo è meglio che riportare «salvato» su una scrittura
     * che non è avvenuta, che è il modo per far perdere fiducia in ogni
     * salvataggio successivo.
     */
    return {
      status: "error",
      message:
        "Questo progetto non ha ancora un contesto di lavoro: si crea insieme allo " +
        "Scrum Master AI. Crealo prima, poi il calendario si potrà dichiarare.",
      fields: {},
    };
  }

  /*
   * Anche la panoramica e gli sprint, non solo questa pagina.
   *
   * Il calendario cambia **il disegno del burndown**, che sta là. Rivalidare
   * solo le impostazioni mostrerebbe il calendario nuovo qui e il grafico
   * vecchio altrove.
   */
  revalidatePath(`/progetti/${slug}`);
  revalidatePath(`/progetti/${slug}/sprint`);
  revalidatePath(`/progetti/${slug}/impostazioni`);

  redirect(`/progetti/${slug}/impostazioni?salvato=1&sezione=calendario`);
}

/**
 * «Leggi ora»: una sincronizzazione, su richiesta.
 *
 * Sottile come le altre — ogni decisione sta in `src/lib/projects/sync.ts` — ma
 * con una differenza che vale la pena nominare: questa azione **non** rimanda
 * con un redirect di conferma. Le altre salvano un modulo, e il redirect serve
 * a far sopravvivere «salvato» al rimontaggio. Qui c'è un esito da leggere —
 * quante righe, o perché no — e un redirect lo butterebbe via.
 */
export async function synchroniseAction(
  _previous: SyncFormState,
  form: FormData,
): Promise<SyncFormState> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "error", message: "Progetto non indicato." };
  }

  /*
   * Lo stesso controllo di ruolo del salvataggio, e per una ragione in più.
   *
   * Una lettura consuma la quota di chiamate del cliente sul suo Jira. Un
   * pulsante raggiungibile da chiunque sia entrato è un modo per spendere una
   * risorsa altrui senza esserne responsabili.
   */
  if (!mayConfigureSettings(session.role)) {
    return {
      status: "error",
      message: "Solo il proprietario o un amministratore può avviare una lettura.",
    };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const db = getDatabase();
  const scope = forOrganization(db, organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) return { status: "error", message: "Progetto non trovato." };

  const projectId = projectIdSchema.parse(project.id);
  const settings = await readProjectSettings(organizationId, projectId, db);

  const outcome = await synchroniseProject({
    organizationId,
    projectId,
    settings,
    asOf: new Date(),
    db,
    /*
     * «Rileggi tutto» arriva come un campo del modulo, non come una seconda
     * azione: cambia un parametro della stessa operazione, e duplicarla
     * significherebbe tenere allineati due controlli di ruolo.
     */
    ...(form.get("completa") === "1" ? { full: true } : {}),
  });

  if (outcome.status !== "done") {
    return { status: "error", message: outcome.message };
  }

  /*
   * Tutto ciò che mostra numeri, non solo questa pagina.
   *
   * Una lettura riuscita cambia il burndown, la salute dello sprint e gli
   * elenchi. Rivalidare solo le impostazioni direbbe «letti 340 elementi» sopra
   * una dashboard che mostra ancora quelli di ieri.
   */
  revalidatePath(`/progetti/${slug}`);
  revalidatePath(`/progetti/${slug}/sprint`);
  revalidatePath(`/progetti/${slug}/elementi`);
  revalidatePath(`/progetti/${slug}/impostazioni`);

  return {
    status: "done",
    message: describeReport(outcome.report, outcome.diagnosis),
    at: outcome.at.toISOString(),
  };
}

/**
 * «Prova la connessione»: una chiamata sola, per sapere se la chiave funziona.
 *
 * **Perché non riusa il pulsante che esiste già.** Nel diario dello Scrum
 * Master AI c'è «Prova il collegamento», che fa una cosa simile — ma pretende
 * che l'agente sia già stato creato, e sta due schermate più in là di dove si
 * incolla la chiave. Chi ha appena salvato una credenziale vuole saperlo lì e
 * subito, senza prima creare un agente per scoprire di avere sbagliato a
 * incollare.
 *
 * **Questa esecuzione non finisce nel registro**, e va detto perché è una
 * deroga: il registro tiene le esecuzioni di un agente, e qui un agente può non
 * esistere. Il costo non sparisce, però — viene mostrato nella risposta, che è
 * l'unico posto dove serva a qualcosa.
 */
export async function testModelAction(
  _previous: ModelTestState,
  form: FormData,
): Promise<ModelTestState> {
  const session = await auth();
  if (!session?.organizationId) redirect("/accedi");

  const slug = form.get("slug");
  if (typeof slug !== "string") {
    return { status: "error", message: "Progetto non indicato." };
  }

  /*
   * Lo stesso controllo di ruolo della lettura, e per la stessa ragione: la
   * prova spende, poco ma spende, sulla chiave di qualcun altro.
   */
  if (!mayConfigureSettings(session.role)) {
    return {
      status: "error",
      message: "Solo il proprietario o un amministratore può provare il collegamento.",
    };
  }

  const organizationId = organizationIdSchema.parse(session.organizationId);
  const db = getDatabase();
  const scope = forOrganization(db, organizationId);

  const [project] = await scope.reads.projectBySlug(slug);
  if (!project) return { status: "error", message: "Progetto non trovato." };

  const projectId = projectIdSchema.parse(project.id);
  const settings = await readProjectSettings(organizationId, projectId, db);
  const probe = await modelProbeForProject(organizationId, projectId);

  const outcome = await checkModel({
    gateway: await gatewayForProject(organizationId, projectId),
    provider: settings.brainProvider,
    ...(probe ? { listModels: probe } : {}),
  });

  if (outcome.kind === "fake") {
    return {
      status: "skipped",
      message:
        "Questo progetto usa il modello dimostrativo, che risponde sempre e non chiama nessuno: " +
        "non c'è un collegamento da provare. I numeri restano veri comunque — cambia solo chi li racconta.",
    };
  }

  if (outcome.kind === "failed") {
    /*
     * Il modello richiesto si nomina, perché è il campo che si sbaglia più
     * spesso e perché chi legge non lo ha sotto gli occhi: sta in un altro
     * riquadro, e «controlla il nome del modello» senza dire quale sia stato
     * usato costringe a cercarlo.
     */
    const richiesto = settings.brainModel
      ? `Il modello richiesto era «${settings.brainModel}».`
      : "Nessun modello indicato: è stato usato quello predefinito del portale per questo fornitore.";

    /*
     * E, quando il fornitore ha voluto dirlo, quali nomi accetterebbe.
     *
     * Stesso rimedio della diagnosi Jira: sapere che un nome è sbagliato senza
     * sapere quali siano quelli giusti lascia dove si era. Pochi, perché
     * l'elenco completo di un aggregatore conta centinaia di voci e un muro di
     * nomi non è un aiuto.
     */
    const disponibili =
      outcome.availableModels.length > 0
        ? ` Con questa chiave il fornitore accetta, fra gli altri: ${outcome.availableModels.slice(0, 8).join(", ")}.`
        : "";

    return { status: "error", message: `${outcome.message} ${richiesto}${disponibili}` };
  }

  return {
    status: "done",
    message:
      `Ha risposto ${outcome.provider} con il modello ${outcome.model}, ` +
      `in ${(outcome.durationMs / 1000).toFixed(1)} secondi. Costo stimato: ` +
      `${outcome.costUsd < 0.0001 ? "meno di un decimo di millesimo di dollaro" : `${outcome.costUsd.toFixed(4)} dollari`}.`,
    reply: outcome.reply,
  };
}
