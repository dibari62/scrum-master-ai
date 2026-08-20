import { integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { auditColumns } from "./organizations";
import { users } from "./users";

/**
 * OAuth accounts linked to a portal user.
 *
 * Column and property names are dictated by `@auth/drizzle-adapter`, including
 * the snake_case token fields: the adapter reads them by name (ADR-0006).
 *
 * The adapter never links an OAuth account to an existing user just because the
 * addresses match — it raises `OAuthAccountNotLinked` instead. That default is
 * the reason this table is not hand-rolled: an address a provider has not
 * verified would otherwise be enough to take over an account.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    /** One row per account at a provider: the pair is the natural identity. */
    primaryKey({
      name: "accounts_provider_account_pk",
      columns: [table.provider, table.providerAccountId],
    }),
  ],
);

/**
 * Password verifiers, kept out of `users` on purpose.
 *
 * A `passwordHash` column on `users` would ride along every time a user is
 * selected and serialised towards the interface. Here the mistake is not
 * unlikely, it is impossible: reaching a hash takes a deliberate join, and
 * only `src/lib/auth` performs it (ADR-0006).
 *
 * One row per user: a second password for the same account has no meaning.
 */
export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Self-describing scrypt verifier produced by `src/lib/password.ts`. */
  passwordHash: text("password_hash").notNull(),
  ...auditColumns,
});
