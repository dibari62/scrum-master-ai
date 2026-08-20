import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt (ADR-0006).
 *
 * scrypt is the only memory-hard key derivation function in Node's standard
 * library: no native dependency to compile on Vercel, and no third-party
 * package to trust with the most sensitive part of the system.
 *
 * The length policy lives in `src/domain/credentials.ts`: what the product
 * accepts is a domain rule, not a property of the algorithm.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Work factors. `N` is the memory/CPU cost, `r` the block size, `p` the
 * parallelism — the values recommended for interactive logins.
 *
 * They are written into every hash, so raising them later only affects new
 * passwords: existing ones keep verifying against the parameters they were
 * created with.
 */
const COST = { N: 16_384, r: 8, p: 1 } as const;

/** scrypt refuses to run if it would exceed this, and the default is below N=16384. */
const MAX_MEMORY = 64 * 1024 * 1024;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

const ALGORITHM = "scrypt";
const FIELD_SEPARATOR = "$";

/**
 * Derives a verifier for `password`.
 *
 * The result is self-describing — `scrypt$N$r$p$salt$key` — so a stored hash
 * carries everything needed to check it, including the cost in force the day
 * it was created.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_BYTES, {
    ...COST,
    maxmem: MAX_MEMORY,
  });

  return [
    ALGORITHM,
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join(FIELD_SEPARATOR);
}

type ParsedHash = {
  readonly cost: { readonly N: number; readonly r: number; readonly p: number };
  readonly salt: Buffer;
  readonly key: Buffer;
};

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split(FIELD_SEPARATOR);
  if (parts.length !== 6) return null;

  const [algorithm, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  if (algorithm !== ALGORITHM) return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N <= 1 || r < 1 || p < 1) return null;

  if (rawSalt === undefined || rawKey === undefined) return null;
  const salt = Buffer.from(rawSalt, "base64");
  const key = Buffer.from(rawKey, "base64");
  if (salt.length === 0 || key.length === 0) return null;

  return { cost: { N, r, p }, salt, key };
}

/**
 * Checks `password` against a stored verifier.
 *
 * Returns `false` for a malformed or unknown-algorithm hash rather than
 * throwing: a corrupt row must fail the login, not turn into a 500 that tells
 * the caller something unusual exists for that account.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  const candidate = await scryptAsync(password, parsed.salt, parsed.key.length, {
    ...parsed.cost,
    maxmem: MAX_MEMORY,
  });

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal; the lengths are equal by construction, this is the guard.
  if (candidate.length !== parsed.key.length) return false;

  return timingSafeEqual(candidate, parsed.key);
}

/**
 * A hash of a value nobody knows, generated once per process.
 *
 * Used to spend the same work when no account matches the submitted address.
 * Without it, a missing user answers immediately while an existing one waits
 * for scrypt, and the difference enumerates registered addresses.
 */
const decoyHash: Promise<string> = hashPassword(randomBytes(32).toString("base64"));

/**
 * Runs a verification that is guaranteed to fail, at the usual cost.
 *
 * Call it on the "user not found" branch of a sign-in so that branch takes as
 * long as the others.
 */
export async function spendVerificationTime(password: string): Promise<false> {
  await verifyPassword(password, await decoyHash);
  return false;
}
