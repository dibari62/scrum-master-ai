import { z } from "zod";

import { auditFields, displayNameSchema, emailSchema, timestampSchema } from "./common";
import { userIdSchema } from "./ids";

/**
 * `User` is whoever signs in to the portal. It is **not** `Person`, which
 * models a team member as they appear in an ingested data source and is
 * pseudonymisable (glossary §1 and §2). The two are separate on purpose: a
 * stakeholder may sign in without ever appearing on a board, and a `Person`
 * seen in Jira may never hold an account here.
 *
 * A `User` is not owned by an organization: membership does that, so the same
 * account can belong to several organizations without being duplicated.
 *
 * Credentials never live here. A password hash on this schema would ride along
 * every time a user is serialised towards the interface; it belongs to the
 * authentication layer, not to the canonical model.
 */
export const userSchema = z.object({
  id: userIdSchema,
  email: emailSchema,
  /** Absent until the person chooses one: the sign-up form only asks for an email. */
  name: displayNameSchema.nullable(),
  /** `null` while the address is unverified. */
  emailVerifiedAt: timestampSchema.nullable(),
  ...auditFields,
});

export type User = z.infer<typeof userSchema>;

export const createUserInputSchema = userSchema.pick({ email: true, name: true });

export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = userSchema.pick({ name: true }).partial();

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
