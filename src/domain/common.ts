import { z } from "zod";

import { organizationIdSchema, projectIdSchema } from "./ids";

/**
 * Primitives shared by every canonical entity. Declaring them once is what
 * makes R4 ("one shape, one place") enforceable rather than aspirational.
 */

/**
 * Accepts a `Date` or an ISO 8601 string and always yields a `Date`.
 *
 * Deliberately not `z.coerce.date()`: coercion feeds anything to the `Date`
 * constructor, so `true` and `0` become valid timestamps. Instants crossing an
 * API boundary arrive as strings, everything else already holds a `Date`.
 * Storage is always UTC (AGENTS.md §7).
 */
export const timestampSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
]);

/** Human-readable label. Trimmed first, so "   " is rejected as empty. */
export const displayNameSchema = z.string().trim().min(1).max(120);

/**
 * URL-safe identifier used in paths such as `/acme/checkout-2026`.
 * Lowercase alphanumeric groups separated by single hyphens: no leading,
 * trailing or doubled hyphen, so one name has exactly one valid slug.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(2)
      .max(48)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Lo slug ammette solo lettere minuscole, cifre e trattini singoli.",
      ),
  );

/** Normalised before validation: addresses differing only in case are the same account. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Free text attached to an entity. Empty is expressed as `null`, never as "". */
export const descriptionSchema = z.string().trim().max(2000).nullable();

/** Audit fields carried by every persisted entity. */
export const auditFields = {
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
} as const;

/**
 * Carried by every record that belongs to a project.
 *
 * `organizationId` is repeated alongside `projectId` even though the project
 * already implies it. It is denormalisation on purpose: the tenant filter of
 * §8.4 then applies to every table directly, without a join whose absence
 * would silently widen a query.
 */
export const projectScopedFields = {
  organizationId: organizationIdSchema,
  projectId: projectIdSchema,
} as const;

/**
 * Derives a candidate slug from a human name, for prefilling a form field.
 *
 * A suggestion, not a guarantee: the result still goes through `slugSchema`,
 * which rejects what this cannot fix — an empty name, or one made entirely of
 * characters that do not survive the transformation.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    // Strip combining marks so "Città" becomes "citta" rather than losing the vowel.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
