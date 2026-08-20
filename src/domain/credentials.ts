import { z } from "zod";

import { displayNameSchema, emailSchema, slugSchema } from "./common";

/**
 * Credential policy.
 *
 * Lives in the domain rather than next to the hashing code because it is a
 * rule about what the product accepts, not about how a verifier is computed —
 * and because `src/domain` may not import from `src/lib` (AGENTS.md §4).
 */

/**
 * Length beats contrived complexity: a rule demanding a symbol produces
 * "Password1!", a rule demanding length produces a passphrase.
 */
export const PASSWORD_MIN_LENGTH = 12;

/** scrypt is deliberately expensive, and the server pays for the input it is given. */
export const PASSWORD_MAX_LENGTH = 256;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La password deve avere almeno ${PASSWORD_MIN_LENGTH} caratteri.`)
  .max(PASSWORD_MAX_LENGTH);

/**
 * Sign-in deliberately does **not** apply the policy above.
 *
 * An account created before a policy change must still be able to sign in, and
 * answering "too short" to a login attempt would confirm the address exists
 * while describing the rules to whoever is guessing.
 */
export const signInInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type SignInInput = z.infer<typeof signInInputSchema>;

/**
 * Registration creates a company and its first user in one step: an
 * organization with no owner would be unreachable, so the two are never
 * created apart.
 */
export const signUpInputSchema = z.object({
  organizationName: displayNameSchema,
  organizationSlug: slugSchema,
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export type SignUpInput = z.infer<typeof signUpInputSchema>;
