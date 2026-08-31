import { sql } from "drizzle-orm";
import { check, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { sourceSystemSchema, syncScheduleSchema, type ProjectSettings } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns } from "./organizations";
import { llmProvider } from "./scrum-agent";
import { projectScopedColumns } from "./shared-columns";

/**
 * How a project is **wired to the outside world**: where its data comes from and
 * which model narrates it.
 *
 * A table of its own rather than more columns on `project_contexts`, and the
 * reason is security rather than tidiness. **There are secrets here.** Almost
 * every page reads the project context; if the customer's API key lived on that
 * row, it would be loaded into memory dozens of times a day by code that has no
 * business holding it. Separating the two means a secret leaves the database
 * only where somebody asked for it.
 *
 * ADR-0010: the model key and the connector token belong to the customer. We
 * keep them encrypted and never hand them back to a browser.
 */

/**
 * Which external tool a project reads from.
 *
 * Generated from the Zod enum (R8), like every other persisted enum: retyping
 * the values would create a second definition that drifts the day a connector is
 * added, and the drift only shows as a failed INSERT.
 */
export const connectorChoice = pgEnum("connector_choice", enumValues(sourceSystemSchema));

/**
 * Ogni quanto la lettura riparte da sola.
 *
 * Generato dall'enum Zod come tutti gli altri (R8): riscrivere i valori a mano
 * creerebbe una seconda definizione, e la divergenza si vedrebbe solo il giorno
 * di un INSERT rifiutato.
 */
export const syncSchedule = pgEnum("sync_schedule", enumValues(syncScheduleSchema));

export const projectSettings = pgTable(
  "project_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...projectScopedColumns,

    /** `null` while nobody has chosen where the data comes from. */
    connector: connectorChoice("connector"),

    /**
     * The connector's own configuration, opaque to the database and to the
     * domain.
     *
     * R2 forbids a Jira type outside `src/connectors/jira`, so nothing here
     * describes a board or a project key: the connector validates the object
     * with its own schema, which stays the single source of truth for that
     * shape (R4).
     */
    connectorConfig: jsonb("connector_config")
      .$type<ProjectSettings["connectorConfig"]>()
      .notNull()
      .default({}),

    /**
     * The connector credential, **already encrypted** (ADR-0010).
     *
     * The check constraint below is the last line of defence: `$type<>()` is a
     * declaration of ours, not a rule the database enforces, and a row written
     * by hand could otherwise hold a raw Jira token. Postgres refuses.
     */
    connectorSecret: text("connector_secret"),
    connectorSecretUpdatedAt: timestamp("connector_secret_updated_at", { withTimezone: true }),

    /**
     * When a synchronisation last succeeded.
     *
     * Distinct from `updated_at`, which moves when somebody edits the form.
     * «Chi ha cambiato la configurazione» e «quando abbiamo letto Jira l'ultima
     * volta» sono due domande diverse, e un campo solo risponderebbe male a
     * entrambe.
     */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    /**
     * Ogni quanto la lettura riparte da sola.
     *
     * Predefinito `manual`, e non è prudenza generica: ogni lettura consuma la
     * quota di chiamate del cliente sul suo Jira. Un progetto che non ha chiesto
     * nulla non deve trovarsi un timer acceso — e una migrazione che accendesse
     * l'automatismo su ogni progetto esistente sarebbe esattamente questo.
     */
    syncSchedule: syncSchedule("sync_schedule").notNull().default("manual"),

    /**
     * Which model this project's Scrum Master AI thinks with.
     *
     * Defaults to `fake`, which answers without calling anyone. A project
     * created before somebody has a key is a project that works — it just says
     * so — and that is the difference between a portal you can try and one that
     * demands a credential before showing anything (§9).
     */
    brainProvider: llmProvider("brain_provider").notNull().default("fake"),

    /** `null` means «whatever the provider's default is», never an empty name. */
    brainModel: text("brain_model"),

    /**
     * Sovrascrive l'indirizzo del fornitore.
     *
     * Serve a due casi reali e non ipotetici: un Ollama che gira su un'altra
     * macchina della rete aziendale, e un gateway interno che espone la stessa
     * API dietro un indirizzo proprio. Senza questa colonna entrambi
     * resterebbero fuori, e con loro l'unico modo di far girare lo Scrum Master
     * AI **senza che il testo dei ticket lasci l'azienda**.
     */
    brainBaseUrl: text("brain_base_url"),

    brainApiKey: text("brain_api_key"),
    brainApiKeyUpdatedAt: timestamp("brain_api_key_updated_at", { withTimezone: true }),

    ...auditColumns,
  },
  (table) => [
    /** One row of settings per project. */
    unique("project_settings_project_key").on(table.projectId),

    /*
     * Nessun segreto in chiaro, e lo dice il database.
     *
     * Un segreto cifrato comincia sempre per `v1.` (ADR-0010). Il vincolo non
     * verifica che la cifratura sia valida — non può — ma rende **impossibile**
     * il caso che conta: qualcuno che scrive una chiave API grezza in questa
     * colonna, da un'azione dimenticata o da una query a mano.
     */
    check(
      "project_settings_connector_secret_sealed",
      sql`${table.connectorSecret} IS NULL OR ${table.connectorSecret} LIKE 'v1.%'`,
    ),
    check(
      "project_settings_brain_api_key_sealed",
      sql`${table.brainApiKey} IS NULL OR ${table.brainApiKey} LIKE 'v1.%'`,
    ),

    /*
     * Un segreto e la data in cui è stato inserito stanno insieme o non stanno.
     *
     * Una chiave senza data lascia senza risposta «è ancora quella vecchia?»,
     * che è la domanda che si fa chi sta per revocarla.
     */
    check(
      "project_settings_connector_secret_dated",
      sql`(${table.connectorSecret} IS NULL) = (${table.connectorSecretUpdatedAt} IS NULL)`,
    ),
    check(
      "project_settings_brain_api_key_dated",
      sql`(${table.brainApiKey} IS NULL) = (${table.brainApiKeyUpdatedAt} IS NULL)`,
    ),

    // Un modello dichiarato con la stringa vuota verrebbe spedito così com'è.
    check(
      "project_settings_brain_model_check",
      sql`${table.brainModel} IS NULL OR char_length(${table.brainModel}) BETWEEN 1 AND 120`,
    ),

    /*
     * Un indirizzo, non una stringa qualunque.
     *
     * Il valore finisce dentro una `fetch`: senza vincolo, un campo compilato
     * male produrrebbe una chiamata verso un indirizzo relativo del portale
     * stesso, e l'errore comparirebbe come «il fornitore non risponde».
     */
    check(
      "project_settings_brain_base_url_check",
      sql`${table.brainBaseUrl} IS NULL OR ${table.brainBaseUrl} ~ '^https?://'`,
    ),
  ],
);
