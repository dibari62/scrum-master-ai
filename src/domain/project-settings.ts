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

  brainProvider: brainProviderSchema,

  /**
   * The exact model, when the project wants one in particular.
   *
   * `null` means «whatever the provider's default is». Not an empty string: an
   * empty string is a model named nothing, and would be sent as such.
   */
  brainModel: z.string().trim().min(1).max(120).nullable(),

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
 */
export const updateProjectSettingsInputSchema = z.object({
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

  brainProvider: brainProviderSchema,
  brainModel: z.string().trim().min(1).max(120).nullable(),
  brainApiKey: z.string().min(1).max(500).nullable().optional(),
});

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
  brainProvider: "fake",
  brainModel: null,
  brainApiKey: null,
  brainApiKeyUpdatedAt: null,
} as const satisfies Omit<
  ProjectSettings,
  "id" | "organizationId" | "projectId" | "createdAt" | "updatedAt"
>;

/**
 * Whether the project can actually reach a model.
 *
 * `fake` can: it answers without calling anyone. Every other provider needs the
 * key the customer brings, and saying so before a skill fails is the difference
 * between a screen that explains and one that breaks.
 */
export function brainReady(settings: {
  readonly brainProvider: BrainProvider;
  readonly brainApiKey: string | null;
}): boolean {
  return settings.brainProvider === "fake" || settings.brainApiKey !== null;
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
