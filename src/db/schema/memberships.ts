import { index, pgEnum, pgTable, unique, uuid } from "drizzle-orm/pg-core";

import { organizationRoleSchema } from "@/domain";

import { enumValues } from "./enum-values";
import { auditColumns, organizations } from "./organizations";
import { users } from "./users";

/**
 * The Postgres enum is generated from the Zod enum, not retyped next to it.
 * Two hand-written lists drift the day someone adds a role to one of them, and
 * R4 exists precisely to make that impossible.
 */
export const organizationRole = pgEnum(
  "organization_role",
  enumValues(organizationRoleSchema),
);

/**
 * Grants a user access to an organization, with a role.
 *
 * `onDelete: "cascade"` on both sides: a membership without its organization
 * or without its user is an access grant pointing at nothing, and orphan rows
 * in an authorisation table are exactly the kind of leftover that later gets
 * read as "someone still has access".
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRole("role").notNull(),
    ...auditColumns,
  },
  (table) => [
    /** One membership per user per organization: the role must be unambiguous. */
    unique("memberships_organization_user_key").on(table.organizationId, table.userId),
    /** Every read is filtered by tenant, so this index is on the hot path. */
    index("memberships_organization_id_idx").on(table.organizationId),
    /** "Which organizations does this user belong to?" — asked on every sign-in. */
    index("memberships_user_id_idx").on(table.userId),
  ],
);
