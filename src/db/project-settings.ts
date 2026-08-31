import { and, eq } from "drizzle-orm";

import {
  projectSettingsSchema,
  UNCONFIGURED_SETTINGS,
  type OrganizationId,
  type ProjectId,
  type ProjectSettings,
  type SecretPresence,
  type UpdateProjectSettingsInput,
} from "@/domain";
import { hintOf, seal, unseal } from "@/lib/secrets";

import { getDatabase, type Database } from "./client";
import { projectSettings } from "./schema";

/**
 * L'unico modulo che tocca i segreti dei clienti.
 *
 * **Perché sta qui e non fra gli altri quaranta metodi di `tenant.ts`.** Quel
 * file è la porta d'ingresso di ogni lettura dell'applicazione, e una chiave API
 * fra quei metodi sarebbe una chiave API a portata di qualunque pagina che
 * cerchi qualcos'altro. Isolarla non è ordine: riduce il numero di posti da cui
 * un segreto può uscire, che è l'unica difesa che funziona davvero.
 *
 * L'isolamento fra organizzazioni resta garantito allo stesso modo (§8.4):
 * `organizationId` entra nella condizione qui dentro, una volta, e nessun
 * chiamante lo può omettere — è un parametro obbligatorio.
 *
 * ADR-0010 per il motivo per cui i segreti sono cifrati.
 */

/**
 * Le impostazioni, **senza i segreti**, come le riceve una schermata.
 *
 * Un tipo diverso da `ProjectSettings` e non lo stesso con i campi svuotati: due
 * tipi rendono impossibile passare per sbaglio l'oggetto sbagliato a una pagina,
 * mentre un tipo solo con la disciplina di svuotarlo funziona finché qualcuno
 * non si dimentica.
 */
export type SafeProjectSettings = Omit<
  ProjectSettings,
  "id" | "organizationId" | "connectorSecret" | "brainApiKey"
> & {
  readonly connectorSecret: SecretPresence;
  readonly brainApiKey: SecretPresence;
};

/**
 * Le impostazioni di un progetto, con i segreti ridotti a un indizio.
 *
 * Restituisce sempre qualcosa: un progetto mai configurato ha impostazioni
 * predefinite, non impostazioni assenti. Una pagina che dovesse trattare
 * «assenti» a parte finirebbe per avere un secondo insieme di valori
 * predefiniti, più silenzioso del primo.
 */
export async function readProjectSettings(
  organizationId: OrganizationId,
  projectId: ProjectId,
  db: Database = getDatabase(),
): Promise<SafeProjectSettings> {
  const row = await loadRow(organizationId, projectId, db);

  if (!row) {
    return {
      projectId,
      ...UNCONFIGURED_SETTINGS,
      connectorSecret: absent(),
      brainApiKey: absent(),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  const settings = projectSettingsSchema.parse(row);

  return {
    projectId: settings.projectId,
    connector: settings.connector,
    connectorConfig: settings.connectorConfig,
    connectorSecret: presenceOf(settings.connectorSecret, settings.connectorSecretUpdatedAt),
    connectorSecretUpdatedAt: settings.connectorSecretUpdatedAt,
    lastSyncedAt: settings.lastSyncedAt,
    syncSchedule: settings.syncSchedule,
    brainProvider: settings.brainProvider,
    brainModel: settings.brainModel,
    brainBaseUrl: settings.brainBaseUrl,
    brainApiKey: presenceOf(settings.brainApiKey, settings.brainApiKeyUpdatedAt),
    brainApiKeyUpdatedAt: settings.brainApiKeyUpdatedAt,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

/**
 * Il segreto in chiaro, per chi deve usarlo davvero.
 *
 * Una funzione separata e con un nome che non lascia dubbi: chiamarla è una
 * decisione, e chi la scrive sa di averla presa. `readProjectSettings` non lo
 * restituisce mai, così una pagina non può stamparlo per distrazione.
 *
 * Restituisce `null` sia quando il segreto non c'è sia quando la chiave
 * principale non lo apre: chi lo usa deve gestire l'assenza comunque, e due esiti
 * diversi per «non posso darti la chiave» complicherebbero ogni chiamante senza
 * dargli nulla da fare in più.
 */
export async function revealProjectSecret(
  organizationId: OrganizationId,
  projectId: ProjectId,
  which: "connector" | "brain",
  db: Database = getDatabase(),
): Promise<string | null> {
  const row = await loadRow(organizationId, projectId, db);
  if (!row) return null;

  const sealed = which === "connector" ? row.connectorSecret : row.brainApiKey;
  if (sealed === null) return null;

  try {
    return unseal(sealed);
  } catch {
    /*
     * Una chiave illeggibile non è un'eccezione da propagare.
     *
     * Succede quando `SECRETS_KEY` è cambiata, e in quel caso ogni segreto di
     * ogni progetto è illeggibile insieme: far esplodere la pagina non aiuta
     * nessuno, mentre «la chiave va reinserita» è un'informazione su cui si può
     * agire. Chi chiama tratta `null` come «non configurata», che è ciò che di
     * fatto è.
     */
    return null;
  }
}

/**
 * Scrive le impostazioni, cifrando ciò che va cifrato.
 *
 * I segreti arrivano in chiaro — è l'unico momento in cui esistono legittimamente
 * così, fra un browser e un'azione server — e vengono sigillati **prima** di
 * toccare una colonna. Il vincolo sul database rifiuterebbe comunque una scrittura
 * in chiaro, ed è voluto che ci siano due difese: quella qui è quella che
 * funziona, quella nel database è quella che resta se questa viene aggirata.
 *
 * Un segreto `undefined` lascia stare quello memorizzato. Non è pigrizia: il
 * modulo non restituisce mai una chiave a un browser, quindi un modulo non può
 * rimandarla indietro — e un campo assente che cancellasse la chiave farebbe
 * perdere la configurazione a ogni salvataggio.
 *
 * **Accetta metà input.** La schermata è divisa in schede, quindi arrivano invii
 * che parlano solo del connettore o solo del modello: ciò che non è nominato
 * resta com'è. Con un input intero obbligatorio, salvare una scheda cancellerebbe
 * l'altra.
 */
export async function writeProjectSettings(
  organizationId: OrganizationId,
  projectId: ProjectId,
  input: Partial<UpdateProjectSettingsInput>,
  now: Date,
  db: Database = getDatabase(),
): Promise<void> {
  const existing = await loadRow(organizationId, projectId, db);

  const connectorSecret = nextSecret(existing?.connectorSecret ?? null, input.connectorSecret);
  const brainApiKey = nextSecret(existing?.brainApiKey ?? null, input.brainApiKey);

  /** Ciò che il modulo non ha nominato resta com'è, o assume il predefinito. */
  const keep = <Value>(sent: Value | undefined, stored: Value | null, fallback: Value): Value =>
    sent !== undefined ? sent : (stored ?? fallback);

  /*
   * Il cursore si azzera quando cambia **che cosa** si sta leggendo.
   *
   * **Il difetto che questa riga ripara, trovato su un'istanza vera.** Il
   * cursore `lastSyncedAt` fa sì che ogni lettura dopo la prima chieda a Jira
   * soltanto «che cosa è cambiato da allora». È giusto finché si guarda lo
   * stesso posto — ed è un buco nero appena quel posto cambia: chi corregge una
   * chiave di progetto sbagliata continua a chiedere solo le novità, e tutto ciò
   * che esisteva prima della correzione **non viene letto mai più**.
   *
   * Succede in silenzio, ed è la forma peggiore: la lettura riesce, non riporta
   * errori, e il portale resta vuoto senza che nulla lo spieghi.
   *
   * Si azzera anche per la mappatura degli stati, che a rigore cambia solo
   * l'interpretazione: ma un elemento già tradotto con la mappatura vecchia
   * resta sbagliato finché non lo si rilegge. Il prezzo è una lettura completa
   * in più; il prezzo dell'alternativa è non accorgersene.
   */
  const watchingSomethingElse =
    (input.connector !== undefined && input.connector !== (existing?.connector ?? null)) ||
    (input.connectorConfig !== undefined &&
      !sameConfiguration(input.connectorConfig, existing?.connectorConfig ?? null)) ||
    connectorSecret.changed;

  const values = {
    organizationId,
    projectId,
    connector: input.connector !== undefined ? input.connector : (existing?.connector ?? null),
    connectorConfig: keep(input.connectorConfig, existing?.connectorConfig ?? null, {}),
    connectorSecret: connectorSecret.value,
    connectorSecretUpdatedAt: connectorSecret.changed
      ? connectorSecret.value === null
        ? null
        : now
      : (existing?.connectorSecretUpdatedAt ?? null),
    ...(watchingSomethingElse ? { lastSyncedAt: null } : {}),

    /*
     * La frequenza non è «cosa si guarda», quindi non azzera il cursore.
     *
     * Passare da «ogni ora» a «una volta al giorno» non rende incompleto nulla
     * di ciò che è già stato letto: cambia solo quando si tornerà a chiedere.
     * Azzerare il cursore qui costringerebbe a una rilettura completa a ogni
     * ripensamento sul ritmo.
     */
    syncSchedule:
      input.syncSchedule !== undefined
        ? input.syncSchedule
        : (existing?.syncSchedule ?? "manual"),
    brainProvider: keep(input.brainProvider, existing?.brainProvider ?? null, "fake" as const),
    brainModel:
      input.brainModel !== undefined ? input.brainModel : (existing?.brainModel ?? null),
    brainBaseUrl:
      input.brainBaseUrl !== undefined ? input.brainBaseUrl : (existing?.brainBaseUrl ?? null),
    brainApiKey: brainApiKey.value,
    brainApiKeyUpdatedAt: brainApiKey.changed
      ? brainApiKey.value === null
        ? null
        : now
      : (existing?.brainApiKeyUpdatedAt ?? null),
    updatedAt: now,
  };

  await db
    .insert(projectSettings)
    .values(values)
    .onConflictDoUpdate({ target: projectSettings.projectId, set: values });
}

/**
 * Due configurazioni sono la stessa cosa?
 *
 * Confronto per valore e non per riferimento, con le chiavi in ordine: due
 * oggetti uguali scritti in ordine diverso descrivono lo stesso posto, e
 * trattarli come diversi provocherebbe una rilettura completa a ogni
 * salvataggio.
 */
function sameConfiguration(next: unknown, previous: unknown): boolean {
  return stableJson(next) === stableJson(previous);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || typeof nested !== "object" || Array.isArray(nested)) return nested;

    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  });
}

/** Marks a synchronisation as having succeeded, without touching anything else. */
export async function markSynchronised(
  organizationId: OrganizationId,
  projectId: ProjectId,
  at: Date,
  db: Database = getDatabase(),
): Promise<void> {
  await db
    .update(projectSettings)
    .set({ lastSyncedAt: at })
    .where(
      and(
        eq(projectSettings.organizationId, organizationId),
        eq(projectSettings.projectId, projectId),
      ),
    );
}

async function loadRow(
  organizationId: OrganizationId,
  projectId: ProjectId,
  db: Database,
): Promise<typeof projectSettings.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(projectSettings)
    .where(
      and(
        eq(projectSettings.organizationId, organizationId),
        eq(projectSettings.projectId, projectId),
      ),
    );

  return row;
}

/**
 * Decides what the stored secret becomes.
 *
 * Three inputs and three outcomes, kept in one place so no call site has to
 * remember which of `undefined` and `null` means what.
 */
function nextSecret(
  stored: string | null,
  submitted: string | null | undefined,
): { readonly value: string | null; readonly changed: boolean } {
  if (submitted === undefined) return { value: stored, changed: false };
  if (submitted === null) return { value: null, changed: stored !== null };

  return { value: seal(submitted), changed: true };
}

function presenceOf(sealed: string | null, updatedAt: Date | null): SecretPresence {
  if (sealed === null) return absent();

  /*
   * Le ultime quattro cifre si ricavano decifrando, e se non si può si mostra
   * comunque che una chiave c'è.
   *
   * Nascondere l'esistenza della chiave perché non si riesce a leggerla darebbe
   * a chi guarda l'impressione di non averla mai inserita, e la reinserirebbe
   * senza sapere perché la prima volta non era bastata.
   */
  try {
    return { configured: true, tail: hintOf(unseal(sealed)).tail, updatedAt };
  } catch {
    return { configured: true, tail: "", updatedAt };
  }
}

function absent(): SecretPresence {
  return { configured: false, tail: "", updatedAt: null };
}
