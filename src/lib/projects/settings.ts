import {
  calendarDateSchema,
  connectorChoiceSchema,
  brainProviderSchema,
  updateBrainInputSchema,
  updateConnectorInputSchema,
  updateProjectInputSchema,
  workingCalendarSchema,
  type ConnectorChoice,
  type OrganizationRole,
  type UpdateProjectInput,
  type UpdateProjectSettingsInput,
  type WorkingCalendar,
} from "@/domain";
import { jiraConfigSchema } from "@/connectors/jira";

/**
 * Leggere il modulo delle impostazioni di un progetto.
 *
 * Sta in `src/lib` e non accanto alla pagina per la stessa ragione di
 * `projects/create.ts`: una server action non può essere caricata da un test —
 * il suo identificativo è generato in fase di build — quindi tutto ciò che
 * *decide* qualcosa deve stare fuori. Qui sono funzioni normali su dati normali,
 * chiamate da un'azione sottile.
 *
 * ADR-0010 per il motivo per cui i segreti si trattano diversamente da tutto il
 * resto: arrivano in chiaro, e questo è l'unico momento in cui esistono così.
 */

/**
 * Chi può cambiare le impostazioni.
 *
 * La stessa risposta e lo stesso argomento di `mayCreateProject`, con una
 * ragione in più che qui è decisiva: **queste impostazioni contengono la chiave
 * di fatturazione di un'azienda**. Chi può cambiarle può puntare lo Scrum Master
 * AI su un altro fornitore, o sostituire una chiave con la propria.
 */
const MAY_CONFIGURE: ReadonlySet<OrganizationRole> = new Set(["owner", "admin"]);

export function mayConfigureSettings(role: OrganizationRole | null | undefined): boolean {
  return role !== null && role !== undefined && MAY_CONFIGURE.has(role);
}

export type SettingsFormError = {
  readonly field: string;
  readonly message: string;
};

/**
 * L'anagrafica, che vive su `Project` e non sulle impostazioni.
 *
 * Nome, descrizione e stato erano già nel modello e non avevano un modulo: un
 * progetto si creava e poi era immutabile, e la sola via per archiviarne uno era
 * una `UPDATE` scritta a mano. Sono qui e non in `ProjectSettings` perché
 * appartengono al progetto stesso — duplicarli sarebbe la violazione di R4 che
 * la stessa `UPDATE` scritta a mano poi renderebbe visibile.
 */
export type ParsedIdentityForm =
  | { readonly ok: true; readonly input: UpdateProjectInput }
  | { readonly ok: false; readonly errors: readonly SettingsFormError[] };

export function parseIdentityForm(form: FormData): ParsedIdentityForm {
  const candidate = {
    name: fieldOf(form, "name") ?? "",
    /*
     * `null` quando è vuota, non stringa vuota.
     *
     * Sono due affermazioni diverse: «non l'ho scritta» e «l'ho scritta vuota».
     * La seconda comparirebbe nell'elenco dei progetti come una riga di spazio
     * bianco sotto il nome.
     */
    description: fieldOf(form, "description"),
    status: form.get("status") === "archived" ? ("archived" as const) : ("active" as const),
  };

  const parsed = updateProjectInputSchema.safeParse(candidate);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        field: String(issue.path[0] ?? ""),
        message: issue.message,
      })),
    };
  }

  return { ok: true, input: parsed.data };
}

/** A form value as a trimmed string, or `null` when the field was left empty. */
function fieldOf(form: FormData, name: string): string | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Il calendario lavorativo: quali giorni si lavora, e quali sono festivi.
 *
 * Le festività arrivano come testo, una data per riga. Una riga malformata è
 * segnalata **con il suo numero**: «la riga 3 non è una data» è qualcosa su cui
 * si può agire, «calendario non valido» no.
 */
export type ParsedCalendarForm =
  | { readonly ok: true; readonly calendar: WorkingCalendar }
  | { readonly ok: false; readonly errors: readonly SettingsFormError[] };

export function parseCalendarForm(form: FormData): ParsedCalendarForm {
  const errors: SettingsFormError[] = [];

  const workingDays = form
    .getAll("workingDays")
    .filter((value): value is string => typeof value === "string");

  const holidays: string[] = [];
  const raw = fieldOf(form, "holidays");

  for (const [index, line] of (raw ?? "").split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    if (!calendarDateSchema.safeParse(trimmed).success) {
      errors.push({
        field: "holidays",
        message: `Riga ${index + 1}: «${trimmed}» non è una data nella forma AAAA-MM-GG.`,
      });
      continue;
    }

    /*
     * Una data ripetuta non è un errore, ma non va conservata due volte.
     *
     * Chi incolla due elenchi sovrapposti — le nazionali più quelle aziendali —
     * lo fa senza pensarci, e rifiutare il salvataggio per questo sarebbe
     * pedanteria. Contarla due volte invece non cambierebbe nessun calcolo ma
     * gonfierebbe l'elenco a ogni salvataggio.
     */
    if (!holidays.includes(trimmed)) holidays.push(trimmed);
  }

  const parsed = workingCalendarSchema.safeParse({ workingDays, holidays });

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ field: String(issue.path[0] ?? ""), message: issue.message });
    }
  }

  if (errors.length > 0 || !parsed.success) return { ok: false, errors };

  return { ok: true, calendar: parsed.data };
}

export type ParsedSettingsForm =
  | { readonly ok: true; readonly input: Partial<UpdateProjectSettingsInput> }
  | { readonly ok: false; readonly errors: readonly SettingsFormError[] };

/**
 * Reads the form, or reports every problem at once.
 *
 * Every problem, not the first: a form that rejects one field at a time makes
 * somebody submit four times to discover four mistakes, and each submission is a
 * chance to retype an API key wrong.
 *
 * **Legge solo la metà che il modulo ha inviato.** Le impostazioni sono divise
 * in due schede, quindi arriva o il connettore o il modello; ciò che non è
 * nominato resta com'è. Un parser che restituisse sempre entrambe le metà
 * manderebbe un modello vuoto quando si salva il connettore, cancellando la
 * configurazione dell'altra scheda.
 */
export function parseSettingsForm(form: FormData): ParsedSettingsForm {
  const errors: SettingsFormError[] = [];
  const input: Record<string, unknown> = {};

  const sezione = field(form, "sezione");

  if (sezione === null || sezione === "dati") {
    const connectorRaw = field(form, "connector");
    const connector: ConnectorChoice | null =
      connectorRaw === null ? null : (connectorChoiceSchema.safeParse(connectorRaw).data ?? null);

    if (connectorRaw !== null && connector === null) {
      errors.push({ field: "connector", message: "Connettore non riconosciuto." });
    }

    const parsed = updateConnectorInputSchema.safeParse({
      connector,
      connectorConfig: connector === "jira" ? jiraConfigFrom(form, errors) : {},
      connectorSecret: secretFrom(form, "connectorSecret"),
    });

    if (parsed.success) Object.assign(input, parsed.data);
    else collect(parsed.error.issues, errors);
  }

  if (sezione === null || sezione === "modello") {
    const brainParsed = brainProviderSchema.safeParse(field(form, "brainProvider") ?? "fake");
    if (!brainParsed.success) {
      errors.push({ field: "brainProvider", message: "Modello non riconosciuto." });
    }

    const parsed = updateBrainInputSchema.safeParse({
      brainProvider: brainParsed.success ? brainParsed.data : "fake",
      brainModel: field(form, "brainModel"),
      brainBaseUrl: field(form, "brainBaseUrl"),
      brainApiKey: secretFrom(form, "brainApiKey"),
    });

    if (parsed.success) Object.assign(input, parsed.data);
    else collect(parsed.error.issues, errors);
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, input: input as Partial<UpdateProjectSettingsInput> };
}

function collect(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
  errors: SettingsFormError[],
): void {
  for (const issue of issues) {
    errors.push({ field: String(issue.path[0] ?? ""), message: issue.message });
  }
}

/** A form value as a trimmed string, or `null` when the field was left empty. */
function field(form: FormData, name: string): string | null {
  return fieldOf(form, name);
}

/**
 * What the form is asking to do with a secret.
 *
 * Three outcomes and not two. The form never shows the stored key — it cannot,
 * §8.3 — so an empty field means «non l'ho toccata», never «cancellala».
 * Deleting needs a deliberate act, which is the checkbox.
 */
function secretFrom(
  form: FormData,
  name: string,
): string | null | undefined {
  if (form.get(`${name}-rimuovi`) === "on") return null;

  return field(form, name) ?? undefined;
}

/**
 * The Jira half, validated by the connector's own schema.
 *
 * **The validation happens here and not in the domain**, on purpose: R2 forbids
 * a Jira type outside `src/connectors/jira`, so the shape of a board is the
 * connector's business. The domain guarantees «there is a configuration»; the
 * connector guarantees «this one is usable».
 */
function jiraConfigFrom(form: FormData, errors: SettingsFormError[]): Record<string, unknown> {
  const boardRaw = field(form, "jiraBoardId");
  const boardId = boardRaw === null ? Number.NaN : Number(boardRaw);

  const candidate = {
    siteUrl: field(form, "jiraSiteUrl") ?? "",
    projectKey: field(form, "jiraProjectKey") ?? "",
    boardId,
    stateMapping: parseStateMapping(field(form, "jiraStateMapping"), errors),
    howToDemoFieldName: field(form, "jiraHowToDemoField"),
  };

  const parsed = jiraConfigSchema.safeParse(candidate);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ field: jiraFieldName(String(issue.path[0] ?? "")), message: issue.message });
    }
    return {};
  }

  return parsed.data;
}

/** Maps a schema path back to the input the reader actually filled in. */
function jiraFieldName(path: string): string {
  const names: Readonly<Record<string, string>> = {
    siteUrl: "jiraSiteUrl",
    projectKey: "jiraProjectKey",
    boardId: "jiraBoardId",
    stateMapping: "jiraStateMapping",
    howToDemoFieldName: "jiraHowToDemoField",
  };

  return names[path] ?? path;
}

/**
 * The state mapping, written one per line as `Stato Jira = nostro stato`.
 *
 * A textarea rather than a growing list of paired inputs, because the mapping is
 * a *list of somebody else's words* and nobody knows how long it is until they
 * look at their board. The format is the shortest thing that survives being
 * copied out of a spreadsheet.
 *
 * A malformed line is reported with its number. «La riga 3 non ha un uguale» is
 * something a person can act on; «mappatura non valida» is not.
 */
export function parseStateMapping(
  text: string | null,
  errors: SettingsFormError[],
): Record<string, string> {
  if (text === null) return {};

  const mapping: Record<string, string> = {};

  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      errors.push({
        field: "jiraStateMapping",
        message: `Riga ${index + 1}: manca il segno «=» fra lo stato Jira e il nostro.`,
      });
      continue;
    }

    const jiraStatus = trimmed.slice(0, separator).trim();
    const ourState = trimmed.slice(separator + 1).trim();

    if (jiraStatus === "" || ourState === "") {
      errors.push({
        field: "jiraStateMapping",
        message: `Riga ${index + 1}: manca uno dei due lati.`,
      });
      continue;
    }

    mapping[jiraStatus] = ourState;
  }

  return mapping;
}

/**
 * The mapping written back out, for a form that has to show what is stored.
 *
 * **Ordered alphabetically, and not in the order it was written.** The mapping
 * makes a round trip through a `jsonb` column, and `jsonb` does not preserve key
 * order — it stores an object, not a document. Writing it back in whatever order
 * Postgres returns would make the textarea shuffle itself between one visit and
 * the next, which looks like the portal editing somebody's configuration behind
 * their back.
 *
 * Alphabetical is arbitrary but **stable**, and stable is the property that
 * matters: the same stored mapping always shows the same way.
 */
export function renderStateMapping(config: Record<string, unknown>): string {
  const mapping = config["stateMapping"];
  if (typeof mapping !== "object" || mapping === null) return "";

  return Object.entries(mapping as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b, "it"))
    .map(([jiraStatus, ourState]) => `${jiraStatus} = ${String(ourState)}`)
    .join("\n");
}

/** A configuration value as a string, for pre-filling a field. */
export function configString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return "";
}
