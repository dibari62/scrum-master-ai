import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { auditColumns } from "./organizations";

/**
 * Portal accounts.
 *
 * Deliberately **not** scoped by organization: the same person may belong to
 * several tenants, and duplicating the account per tenant would mean one
 * password per membership. Access is granted by `memberships`, never by this
 * table, so a user row on its own confers nothing.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored already normalised to lowercase by the domain schema. */
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "date" }),
  ...auditColumns,
});
