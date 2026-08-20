/**
 * Bridge between a Zod enum and a Postgres enum.
 *
 * `pgEnum` wants a non-empty tuple while `zodEnum.options` is a plain array, so
 * without this the only way to connect them is a cast — and a cast here would
 * quietly accept an empty list, producing a Postgres enum with no values.
 * Narrowing it honestly keeps the Zod schema as the single source of truth (R4)
 * and keeps `any` out of the codebase (§7).
 */
export function enumValues<Value extends string>(zodEnum: {
  readonly options: readonly Value[];
}): [Value, ...Value[]] {
  const [first, ...rest] = zodEnum.options;

  if (first === undefined) {
    throw new Error("Un enum di dominio non può essere vuoto.");
  }

  return [first, ...rest];
}
