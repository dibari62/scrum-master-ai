import { z } from "zod";

import { auditFields, projectScopedFields, timestampSchema } from "./common";
import { projectSettingsIdSchema } from "./ids";
import { llmProviderSchema } from "./skill";
import { sourceSystemSchema } from "./source";

/**
 * Come un progetto è **collegato al mondo**: da dove prende i dati e con quale
 * modello li racconta.
 *
 * Distinto da `ProjectContext`, che dice come la squadra ha deciso di lavorare.
 * La separazione non è ordine, è sicurezza: qui dentro ci sono **segreti**, e
 * tenerli in una tabella a parte significa che una lettura del contesto Scrum —
 * che avviene su quasi ogni pagina — non se li porta dietro.
 *
 * ADR-0010: la chiave del modello e il token del connettore li porta il cliente.
 * Noi li custodiamo cifrati e non li restituiamo mai a un browser.
 */

/**
 * A secret already encrypted, recognised by its shape.
 *
 * The domain validates the **form** — `v1.<iv>.<tag>.<ciphertext>` — and knows
 * nothing about the algorithm, which lives in `src/lib/secrets`. That is the
 * right division: the domain's job is to make an unencrypted value impossible to
 * store, not to encrypt it.
 *
 * Without this check the column would accept any string, and the day somebody
 * wrote a raw API key into it nothing would complain — until a backup was read.
 */
export const sealedSecretSchema = z
  .string()
  .regex(
    /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    "Un segreto deve essere cifrato prima di essere conservato.",
  );

/**
 * Which external tool a project reads from.
 *
 * `seed` is a legitimate answer, not a placeholder: a project run on synthetic
 * data is how the portal is demonstrated, and pretending it has no connector
 * would make the demo look broken.
 */
export const connectorChoiceSchema = sourceSystemSchema;

export type ConnectorChoice = z.infer<typeof connectorChoiceSchema>;

/**
 * The connector's own configuration, kept opaque here on purpose.
 *
 * R2 forbids a Jira type outside `src/connectors/jira`, so the domain cannot —
 * and must not — describe what a Jira board looks like. It stores the object and
 * the connector validates it with its own schema, which is the single source of
 * truth for that shape (R4).
 *
 * Two responsibilities, and they are genuinely different: the domain guarantees
 * «there is a configuration, and it belongs to this system»; the connector
 * guarantees «this configuration is usable against Jira».
 */
export const connectorConfigSchema = z.record(z.string(), z.unknown());

/**
 * The model a project's Scrum Master AI thinks with.
 *
 * `fake` answers without calling anyone and costs nothing: it is what a project
 * uses before somebody has a key, and what every test uses. Offering it is not a
 * courtesy — without it the only way to try the portal would be to hand over a
 * credential first (§9).
 */
export const brainProviderSchema = llmProviderSchema;

export type BrainProvider = z.infer<typeof brainProviderSchema>;

/**
 * What a screen may know about a stored secret.
 *
 * Never the secret. A form field pre-filled with an API key would be the same
 * leak as printing it, written in HTML and sent to a browser.
 */
export const secretPresenceSchema = z.object({
  configured: z.boolean(),
  /** The last four characters, the way a card statement names a card. */
  tail: z.string().max(4),
  /** When it was last entered, so «is it the old one?» has an answer. */
  updatedAt: timestampSchema.nullable(),
});

export type SecretPresence = z.infer<typeof secretPresenceSchema>;

/**
 * Ogni quanto il portale rilegge da solo la fonte dati.
 *
 * **Il valore predefinito è «mai», ed è una scelta.** Ogni lettura consuma la
 * quota di chiamate del cliente sul suo Jira: accendere un timer per conto suo,
 * su un progetto che non l'ha chiesto, significherebbe spendere una risorsa
 * altrui. Chi vuole l'automatismo lo dichiara.
 *
 * **Quattro passi e non un campo libero.** Un'espressione cron sarebbe più
 * potente e chiederebbe a chi la scrive di conoscerne la sintassi; queste
 * quattro rispondono alla domanda che una squadra si pone davvero — «voglio i
 * dati freschi per la riunione di domattina» — e nessuna di esse può essere
 * scritta sbagliata.
 */
export const syncScheduleSchema = z.enum(["manual", "hourly", "every-4-hours", "daily"]);

export type SyncSchedule = z.infer<typeof syncScheduleSchema>;

export const projectSettingsSchema = z.object({
  id: projectSettingsIdSchema,
  ...projectScopedFields,

  /** `null` while nobody has chosen where the data comes from. */
  connector: connectorChoiceSchema.nullable(),
  connectorConfig: connectorConfigSchema,
  connectorSecret: sealedSecretSchema.nullable(),
  connectorSecretUpdatedAt: timestampSchema.nullable(),

  /**
   * When the last synchronisation succeeded.
   *
   * Distinct from `updatedAt`, which moves when somebody edits the form. «Chi ha
   * cambiato la configurazione» e «quando abbiamo letto Jira l'ultima volta»
   * sono due domande diverse, e un campo solo risponderebbe male a entrambe.
   */
  lastSyncedAt: timestampSchema.nullable(),

  /**
   * Ogni quanto la lettura riparte da sola.
   *
   * Sta accanto a `lastSyncedAt` perché le due si leggono insieme: la prima dice
   * il ritmo, la seconda dice a che punto siamo del ritmo, e serve conoscerle
   * entrambe per rispondere a «tocca adesso?».
   */
  syncSchedule: syncScheduleSchema,

  brainProvider: brainProviderSchema,

  /**
   * The exact model, when the project wants one in particular.
   *
   * `null` means «whatever the provider's default is». Not an empty string: an
   * empty string is a model named nothing, and would be sent as such.
   */
  brainModel: z.string().trim().min(1).max(120).nullable(),

  /**
   * Overrides the vendor's address: a local model, or a company gateway.
   *
   * `url()` and not a plain string: the value goes into a `fetch`, and a
   * malformed one would produce a call to a relative address of the portal
   * itself — surfacing as «the provider is not answering», which is the wrong
   * place to look.
   */
  brainBaseUrl: z.url().max(300).nullable(),

  brainApiKey: sealedSecretSchema.nullable(),
  brainApiKeyUpdatedAt: timestampSchema.nullable(),

  ...auditFields,
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/**
 * What a form may send, which is **not** what gets stored.
 *
 * Secrets arrive in the clear here — it is the one moment they legitimately
 * exist unencrypted, between a browser and a server action — and are sealed
 * before touching a column. Undefined means «leave what is there»: a form that
 * shows no key cannot send one back, so an absent field must not erase one.
 *
 * **Diviso in due metà, e non è pignoleria.** La schermata mostra il connettore
 * e il modello in due schede, quindi arrivano due invii distinti. Con un unico
 * schema, salvare il connettore manderebbe un modello vuoto — e cancellerebbe la
 * configurazione dell'altra scheda senza che nessuno l'abbia chiesto. Sono due
 * decisioni indipendenti e vanno scritte come tali.
 */
export const updateConnectorInputSchema = z.object({
  connector: connectorChoiceSchema.nullable(),
  connectorConfig: connectorConfigSchema,

  /**
   * `undefined` leaves the stored secret alone; `null` deletes it; a string
   * replaces it.
   *
   * Three states and not two, because «non l'ho toccato» e «voglio toglierlo»
   * sono richieste diverse e una sola delle due deve cancellare qualcosa.
   */
  connectorSecret: z.string().min(1).max(500).nullable().optional(),

  /**
   * `undefined` lascia il ritmo com'è.
   *
   * Serve perché la stessa scheda salva due cose diverse: la configurazione
   * della fonte e la frequenza. Un invio che non nomina la frequenza non deve
   * riportarla a «manuale», che è il difetto per cui esistono i tre stati del
   * campo qui sopra.
   */
  syncSchedule: syncScheduleSchema.optional(),
});

export type UpdateConnectorInput = z.infer<typeof updateConnectorInputSchema>;

export const updateBrainInputSchema = z.object({
  brainProvider: brainProviderSchema,
  brainModel: z.string().trim().min(1).max(120).nullable(),
  brainBaseUrl: z.url().max(300).nullable(),
  brainApiKey: z.string().min(1).max(500).nullable().optional(),
});

export type UpdateBrainInput = z.infer<typeof updateBrainInputSchema>;

/** Both halves at once, for a caller that genuinely has both. */
export const updateProjectSettingsInputSchema = updateConnectorInputSchema.extend(
  updateBrainInputSchema.shape,
);

export type UpdateProjectSettingsInput = z.infer<typeof updateProjectSettingsInputSchema>;

/**
 * The settings a project has before anybody configures it.
 *
 * Not stored: returned when no row exists, so every screen can assume settings
 * are present. A page that had to handle «impostazioni assenti» separately would
 * grow a second, quieter set of defaults.
 */
export const UNCONFIGURED_SETTINGS = {
  connector: null,
  connectorConfig: {},
  connectorSecret: null,
  connectorSecretUpdatedAt: null,
  lastSyncedAt: null,
  syncSchedule: "manual",
  brainProvider: "fake",
  brainModel: null,
  brainBaseUrl: null,
  brainApiKey: null,
  brainApiKeyUpdatedAt: null,
} as const satisfies Omit<
  ProjectSettings,
  "id" | "organizationId" | "projectId" | "createdAt" | "updatedAt"
>;

/**
 * Providers that answer without a credential.
 *
 * `fake` because it calls nobody. `ollama` because it runs on the customer's own
 * machine: demanding a key would lock out the one option in which the text of
 * the tickets never leaves the company, which is also the option with the
 * strongest reason to be chosen.
 */
const KEYLESS_PROVIDERS: ReadonlySet<BrainProvider> = new Set(["fake", "ollama"]);

/**
 * Whether the project can actually reach a model.
 *
 * Saying so before a skill fails is the difference between a screen that
 * explains and one that breaks.
 */
export function brainReady(settings: {
  readonly brainProvider: BrainProvider;
  readonly brainApiKey: string | null;
}): boolean {
  return KEYLESS_PROVIDERS.has(settings.brainProvider) || settings.brainApiKey !== null;
}

/** Whether a provider needs a credential at all, for a form that must not demand one. */
export function providerNeedsKey(provider: BrainProvider): boolean {
  return !KEYLESS_PROVIDERS.has(provider);
}

/**
 * Whether the connector has everything it needs to run.
 *
 * `seed` needs nothing: it generates its own data. Everything else needs both a
 * configuration and a credential, and having one without the other is the state
 * a half-filled form leaves behind.
 */
export function connectorReady(settings: {
  readonly connector: ConnectorChoice | null;
  readonly connectorConfig: Record<string, unknown>;
  readonly connectorSecret: string | null;
}): boolean {
  if (settings.connector === null) return false;
  if (settings.connector === "seed") return true;

  return settings.connectorSecret !== null && Object.keys(settings.connectorConfig).length > 0;
}
