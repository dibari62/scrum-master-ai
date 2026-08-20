import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { auditColumns } from "./organizations";

/**
 * Portal accounts.
 *
 * Deliberately **not** scoped by organization: the same person may belong to
 * several tenants, and duplicating the account per tenant would mean one
 * password per membership. Access is granted by `memberships`, never by this
 * table, so a user row on its own confers nothing.
 *
 * `emailVerified` and `image` carry names imposed by `@auth/drizzle-adapter`,
 * which reads these properties by name (ADR-0006). The column underneath keeps
 * the name the domain would have chosen. Rows are translated to the canonical
 * `User` by `toDomainUser`, so the constraint stops at this file.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored already normalised to lowercase by the domain schema. */
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: timestamp("email_verified_at", { withTimezone: true, mode: "date" }),
  /** Avatar supplied by an OAuth provider. Written by the adapter, unused so far. */
  image: text("image"),
  ...auditColumns,
});
