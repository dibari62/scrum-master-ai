"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SafeProjectSettings } from "@/db/project-settings";
import { configString, renderStateMapping } from "@/lib/projects/settings";

import { saveSettingsAction, type SettingsFormState } from "./actions";

/**
 * Il modulo delle impostazioni.
 *
 * Componente client, e uno dei pochi dell'applicazione: deve mostrare e
 * nascondere la sezione Jira mentre si sceglie il connettore, e ricordare se una
 * credenziale sta per essere cancellata. Nessuna di queste due cose sopravvive a
 * un Server Component.
 *
 * **Nessun campo è mai precompilato con un segreto.** Non per prudenza generica:
 * un `value` in un `input` finisce nell'HTML che il browser riceve, quindi
 * precompilare la chiave del cliente sarebbe la stessa fuga che la cifratura
 * evita, fatta un livello più in là.
 */

const INITIAL: SettingsFormState = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 " +
  "min-h-28 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none " +
  "transition-[color,box-shadow] focus-visible:ring-[3px]";

const SELECT_CLASS =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 " +
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none " +
  "transition-[color,box-shadow] focus-visible:ring-[3px]";

/** What each connector is, in the words of somebody who has not read the code. */
const CONNECTORS = [
  {
    value: "",
    label: "Nessuno — il progetto resta vuoto",
    explanation: "Nessun dato entra. Le schermate diranno che non c'è nulla da mostrare.",
  },
  {
    value: "seed",
    label: "Dati di esempio",
    explanation:
      "Un progetto inventato, con quattro sprint conclusi e uno in corso. Serve a vedere " +
      "come funziona il portale senza collegare nulla di vero, e a provare lo Scrum Master AI.",
  },
  {
    value: "jira",
    label: "Jira Cloud",
    explanation:
      "Legge issue, sprint e la loro storia da una board Jira. Solo lettura: il portale " +
      "non scrive mai su Jira.",
  },
] as const;

/**
 * What each model is, and what it costs the person choosing it.
 *
 * **`ready` dice la verità sullo stato del portale, non su quello del
 * fornitore.** Gemini e Groq sono decisi in ADR-0005 e dichiarati nel modello,
 * ma nessuno dei due è ancora collegato al proprio SDK: il gateway li salta e la
 * capacità fallisce con «fornitore non collegato».
 *
 * Tacerlo qui sarebbe la cosa peggiore che questa pagina possa fare: manderebbe
 * qualcuno a registrarsi su un sito, generare una credenziale e incollarla, per
 * scoprire poi che non succede nulla — e a quel punto il sospetto cadrebbe sulla
 * chiave, non su di noi.
 */
const BRAINS = [
  {
    value: "fake",
    label: "Nessuno — risposte finte",
    ready: true,
    explanation:
      "Non chiama nessuno e non costa nulla. I numeri restano veri (li calcola il codice); " +
      "i testi che li accompagnano sono segnaposto. È il modo di provare il portale senza " +
      "procurarsi una chiave.",
  },
  {
    value: "gemini",
    label: "Google Gemini (non ancora collegato)",
    ready: false,
    explanation:
      "Ha un piano gratuito con un limite giornaliero, e la chiave si genera su " +
      "aistudio.google.com. La configurazione si salva e la chiave viene custodita cifrata, " +
      "ma il portale non sa ancora parlare con Gemini.",
  },
  {
    value: "groq",
    label: "Groq (non ancora collegato)",
    ready: false,
    explanation:
      "Veloce, con un piano gratuito, e la chiave si genera su console.groq.com. Come per " +
      "Gemini, la configurazione si conserva ma il collegamento non è ancora scritto.",
  },
] as const;

function errorOf(state: SettingsFormState, field: string): string | undefined {
  return state.status === "error" ? state.fields[field] : undefined;
}

export function SettingsForm({
  slug,
  settings,
  custodyReady,
}: {
  readonly slug: string;
  readonly settings: SafeProjectSettings;
  readonly custodyReady: boolean;
}) {
  const [state, action, pending] = useActionState(saveSettingsAction, INITIAL);

  const [connector, setConnector] = useState<string>(settings.connector ?? "");
  const [brain, setBrain] = useState<string>(settings.brainProvider);

  const connectorNote = CONNECTORS.find((entry) => entry.value === connector)?.explanation;
  const chosenBrain = BRAINS.find((entry) => entry.value === brain);

  return (
    <form action={action} className="grid gap-8">
      <input type="hidden" name="slug" value={slug} />

      {state.status === "error" ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      ) : null}

      {!custodyReady ? (
        /*
         * Detto prima, non dopo il tentativo.
         *
         * Scoprirlo al salvataggio significherebbe averla già copiata dal sito
         * del fornitore per niente.
         */
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          Questa installazione non ha una <strong>chiave di custodia</strong>
          {" ("}
          <code className="font-mono">SECRETS_KEY</code>
          {"), "}
          quindi non può conservare credenziali in modo sicuro. Tutto il resto si configura
          lo stesso.
        </p>
      ) : null}

      <section className="grid gap-4">
        <header className="grid gap-1">
          <h2 className="text-lg font-semibold">Da dove arrivano i dati</h2>
          <p className="text-muted-foreground text-sm">
            Il portale non inventa nulla: sprint, elementi e la loro storia arrivano da qui.
            Senza un collegamento le schermate restano vuote — correttamente.
          </p>
        </header>

        <div className="grid gap-2">
          <Label htmlFor="connector">Connettore</Label>
          <select
            id="connector"
            name="connector"
            className={SELECT_CLASS}
            value={connector}
            onChange={(event) => setConnector(event.target.value)}
          >
            {CONNECTORS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          {connectorNote ? (
            <p className="text-muted-foreground text-sm">{connectorNote}</p>
          ) : null}
          {errorOf(state, "connector") ? (
            <p className="text-destructive text-sm">{errorOf(state, "connector")}</p>
          ) : null}
        </div>

        {connector === "jira" ? (
          <div className="grid gap-5 rounded-md border p-4">
            <Field
              name="jiraSiteUrl"
              label="Indirizzo del sito Jira"
              placeholder="https://laMiaAzienda.atlassian.net"
              hint="Quello che compare nella barra del browser quando sei dentro Jira, senza barra finale."
              defaultValue={configString(settings.connectorConfig, "siteUrl")}
              error={errorOf(state, "jiraSiteUrl")}
            />

            <Field
              name="jiraProjectKey"
              label="Chiave del progetto"
              placeholder="SMAI"
              hint="Il prefisso delle issue: in «SMAI-42» la chiave è SMAI."
              defaultValue={configString(settings.connectorConfig, "projectKey")}
              error={errorOf(state, "jiraProjectKey")}
            />

            <Field
              name="jiraBoardId"
              label="Numero della board"
              placeholder="7"
              inputMode="numeric"
              hint="Si legge nell'indirizzo della board Jira, dopo «rapidView=» o «boards/»."
              defaultValue={configString(settings.connectorConfig, "boardId")}
              error={errorOf(state, "jiraBoardId")}
            />

            <div className="grid gap-2">
              <Label htmlFor="jiraStateMapping">Corrispondenza fra gli stati</Label>
              <textarea
                id="jiraStateMapping"
                name="jiraStateMapping"
                rows={6}
                className={TEXTAREA_CLASS}
                placeholder={"To Do = todo\nIn Progress = in_progress\nIn Review = in_review\nDone = done"}
                defaultValue={renderStateMapping(settings.connectorConfig)}
                aria-invalid={errorOf(state, "jiraStateMapping") ? true : undefined}
              />
              {/*
               * La spiegazione più lunga della pagina, e la merita.
               *
               * È l'unica parte che nessuno può indovinare al posto del lettore:
               * i nomi delle colonne li ha scelti la sua squadra, e sbagliarli
               * non produce un errore ma un numero plausibile e falso.
               */}
              <p className="text-muted-foreground text-sm">
                Una riga per ogni colonna della tua board, nella forma{" "}
                <code className="font-mono">Nome in Jira = nostro stato</code>. I nostri stati
                sono sei: <code className="font-mono">todo</code>,{" "}
                <code className="font-mono">in_progress</code>,{" "}
                <code className="font-mono">in_review</code>,{" "}
                <code className="font-mono">blocked</code>,{" "}
                <code className="font-mono">done</code>,{" "}
                <code className="font-mono">cancelled</code>.
              </p>
              <p className="text-muted-foreground text-sm">
                Uno stato che non elenchi qui non blocca la lettura: viene ricondotto alla
                categoria che Jira gli assegna e <strong>segnalato</strong>. Quella categoria
                però conosce solo «da fare», «in corso» e «fatto», quindi una colonna di
                revisione diventerebbe lavoro attivo — e il tempo di attesa in revisione
                sparirebbe dalle misure senza che nulla sembri rotto.
              </p>
              {errorOf(state, "jiraStateMapping") ? (
                <p className="text-destructive text-sm">{errorOf(state, "jiraStateMapping")}</p>
              ) : null}
            </div>

            <Field
              name="jiraHowToDemoField"
              label="Campo «come si dimostra» (facoltativo)"
              placeholder="Criteri di accettazione"
              hint={
                "Jira non ha questo campo: se la tua squadra ne usa uno personalizzato, scrivine " +
                "il nome e il portale lo leggerà. Altrimenti resta vuoto, e la Definition of " +
                "Ready segnalerà la mancanza invece di far finta che ci sia."
              }
              defaultValue={configString(settings.connectorConfig, "howToDemoFieldName")}
              error={errorOf(state, "jiraHowToDemoField")}
            />

            <SecretField
              name="connectorSecret"
              label="Token API di Jira"
              presence={settings.connectorSecret}
              disabled={!custodyReady}
              hint={
                "Si genera su id.atlassian.com/manage/api-tokens. Vale quanto la password " +
                "dell'account: il portale non scrive mai su Jira, ma il token non lo sa."
              }
              error={errorOf(state, "connectorSecret")}
            />
          </div>
        ) : null}
      </section>

      <section className="grid gap-4">
        <header className="grid gap-1">
          <h2 className="text-lg font-semibold">Il modello che scrive i testi</h2>
          <p className="text-muted-foreground text-sm">
            <strong>I numeri non passano mai di qui.</strong> Velocity, burndown, cycle time e
            tutto il resto li calcola il codice, e il modello li riceve già scritti: il suo
            compito è raccontarli, mai produrli.
          </p>
          <p className="text-muted-foreground text-sm">
            La chiave la porti tu. Vuol dire che il consumo lo paghi tu, e che puoi cambiare
            fornitore quando vuoi senza chiedere nulla a noi.
          </p>
        </header>

        <div className="grid gap-2">
          <Label htmlFor="brainProvider">Fornitore</Label>
          <select
            id="brainProvider"
            name="brainProvider"
            className={SELECT_CLASS}
            value={brain}
            onChange={(event) => setBrain(event.target.value)}
          >
            {BRAINS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          {chosenBrain ? (
            <p className="text-muted-foreground text-sm">{chosenBrain.explanation}</p>
          ) : null}
          {errorOf(state, "brainProvider") ? (
            <p className="text-destructive text-sm">{errorOf(state, "brainProvider")}</p>
          ) : null}
        </div>

        {chosenBrain && !chosenBrain.ready ? (
          /*
           * Detto qui e non in un documento.
           *
           * La configurazione si salva davvero e la chiave viene custodita
           * cifrata: non è finta. Ma finché il gateway non sa parlare con questo
           * fornitore, una capacità dello Scrum Master AI fallirebbe — e senza
           * questo avviso il sospetto cadrebbe sulla chiave appena incollata.
           */
          <p
            role="note"
            className="border-muted-foreground/40 rounded-md border px-3 py-2 text-sm"
          >
            <strong>Questo fornitore non è ancora collegato.</strong> Puoi salvare la
            configurazione e la chiave viene custodita cifrata, ma finché il collegamento non
            è scritto lo Scrum Master AI continuerà a rispondere con testi segnaposto. Se
            vuoi solo vedere come funziona il portale, lascia <em>Nessuno</em>: non cambia
            nulla e non ti costa una chiave.
          </p>
        ) : null}

        {brain !== "fake" ? (
          <div className="grid gap-5 rounded-md border p-4">
            <Field
              name="brainModel"
              label="Modello (facoltativo)"
              placeholder="gemini-2.0-flash"
              hint="Lascia vuoto per usare quello predefinito del fornitore."
              defaultValue={settings.brainModel ?? ""}
              error={errorOf(state, "brainModel")}
            />

            <SecretField
              name="brainApiKey"
              label="Chiave API"
              presence={settings.brainApiKey}
              disabled={!custodyReady}
              hint="Viene cifrata prima di essere conservata, e non viene mai rimandata al browser."
              error={errorOf(state, "brainApiKey")}
            />
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-3 border-t pt-6">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva le impostazioni"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  error,
  ...rest
}: {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={error ? true : undefined} {...rest} />
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}

/**
 * Un campo per una credenziale.
 *
 * Tre stati e non due, ed è la parte che si sbaglia. Il campo **non mostra mai**
 * la chiave memorizzata, quindi lasciarlo vuoto non può significare
 * «cancellala»: significherebbe perdere la configurazione a ogni salvataggio in
 * cui si è cambiato qualcos'altro. Cancellare richiede un gesto apposta.
 */
function SecretField({
  name,
  label,
  hint,
  presence,
  disabled,
  error,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly presence: { readonly configured: boolean; readonly tail: string };
  readonly disabled: boolean;
  readonly error?: string | undefined;
}) {
  const [removing, setRemoving] = useState(false);

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>

      {presence.configured ? (
        <p className="text-sm">
          Una credenziale è già configurata
          {presence.tail ? (
            <>
              {" e finisce con "}
              <code className="font-mono">…{presence.tail}</code>
            </>
          ) : null}
          . Lascia il campo vuoto per tenerla com&apos;è.
        </p>
      ) : null}

      <Input
        id={name}
        name={name}
        type="password"
        autoComplete="off"
        disabled={disabled || removing}
        placeholder={presence.configured ? "Scrivi qui solo per sostituirla" : ""}
        aria-invalid={error ? true : undefined}
      />

      {presence.configured ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={`${name}-rimuovi`}
            checked={removing}
            onChange={(event) => setRemoving(event.target.checked)}
          />
          Rimuovi la credenziale memorizzata
        </label>
      ) : null}

      <p className="text-muted-foreground text-sm">{hint}</p>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
