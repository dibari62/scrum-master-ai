import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Columns every domain table carries.
 *
 * `defaultNow()` puts the clock in the database rather than in the
 * application: with several serverless instances, "now" according to the code
 * is whatever each machine believes, and ordering by a timestamp becomes
 * unreliable. Always UTC (AGENTS.md §7).
 */
export const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
};

/**
 * The tenant. Root of every other record: nothing in the domain exists outside
 * an organization, which is what makes the scoped access path of §8.4
 * enforceable.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Globally unique: it appears in URLs. */
  slug: text("slug").notNull().unique(),
  ...auditColumns,
});
