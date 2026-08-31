/**
 * Reading a Postgres unique violation.
 *
 * **Why this is a shared helper.** Checking availability before inserting is a
 * race: two requests for the same slug can both find it free and both insert.
 * The unique constraint is the only real guard, so the error it raises is the
 * signal the interface reacts to — and every feature that inserts a row with a
 * uniqueness rule needs to read that error the same way.
 *
 * Matching on the constraint name rather than on the message text keeps this
 * from breaking when the server locale or the driver's wording changes; the
 * message is only a fallback, because some drivers report the constraint
 * nowhere else.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * How far down the `cause` chain to look.
 *
 * Drizzle wraps a failed statement in a `DrizzleQueryError` and keeps the
 * driver's own error in `cause`, while `db.batch` hands the driver error
 * through untouched. Walking the chain means a caller does not have to know
 * which of the two paths its write took — that difference turned a message on
 * the identifier field into a 500 page the first time it was tried. Bounded
 * rather than unbounded because a cycle in `cause` would hang the request.
 */
const MAX_CAUSE_DEPTH = 5;

function readStringField(error: object, field: string): string | null {
  if (!(field in error)) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function readField(error: object, field: string): unknown {
  return field in error ? (error as Record<string, unknown>)[field] : undefined;
}

/** Names the constraint if *this* error is the violation, ignoring its causes. */
function violationHere(error: object, constraints: readonly string[]): string | null {
  if (readStringField(error, "code") !== UNIQUE_VIOLATION) return null;

  const constraint = readStringField(error, "constraint");
  if (constraint !== null && constraints.includes(constraint)) return constraint;

  const message = readStringField(error, "message") ?? "";
  return constraints.find((name) => message.includes(name)) ?? null;
}

/**
 * Names the violated constraint, or returns `null` when the error is something
 * else entirely.
 *
 * `null` means "not a uniqueness collision I can explain" and callers must
 * rethrow: reporting a connection failure as «identificativo già in uso» would
 * send someone off fixing the wrong thing (§7).
 */
export function uniqueViolationOf(
  error: unknown,
  constraints: readonly string[],
): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;

    const found = violationHere(current, constraints);
    if (found !== null) return found;

    current = readField(current, "cause");
  }

  return null;
}
