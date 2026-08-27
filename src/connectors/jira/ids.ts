import { createHash } from "node:crypto";

/**
 * Stable identifiers, derived from what Jira calls things.
 *
 * The synthetic connector uses `randomUUID`, and for generated data that is
 * fine: nothing outside a single run refers to those records. A real connector
 * cannot afford it. Reconciliation keys on `(organizzazione, sistema,
 * sourceId)`, so the database would survive random identifiers — but a **batch**
 * would not be comparable with itself, and the whole point of an ingestion that
 * repeats harmlessly is that running it twice changes nothing.
 *
 * So the identifier is a function of the thing it names: same issue, same UUID,
 * every time and on every machine. Version 5 of the UUID standard is exactly
 * this — a hash of a name inside a namespace — and using the real format rather
 * than an invented one means the values stay valid UUIDs for a column that
 * demands them.
 */

/**
 * The namespace all Jira identifiers are minted under.
 *
 * A fixed UUID, written here on purpose: a namespace that changed would change
 * every identifier, and the point of the exercise is that they do not change.
 * Two different sources can carry the same key — `10001` is an issue in every
 * Jira on earth — and the namespace is what keeps their derived identifiers
 * apart.
 */
const NAMESPACE = "8d2f1c47-6a3b-4e15-9c08-52b7ad3e9f16";

/** The kind of thing being named, so an issue and a sprint never collide. */
export type JiraEntity =
  | "person"
  | "board"
  | "column"
  | "sprint"
  | "item"
  | "transition"
  | "estimate"
  | "comment";

export function jiraId(entity: JiraEntity, key: string): string {
  const namespaceBytes = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(`${entity}:${key}`, "utf8");

  const hash = createHash("sha1").update(namespaceBytes).update(nameBytes).digest();

  /*
   * I due byte che rendono l'impronta un UUID valido.
   *
   * Senza, il valore sarebbe comunque stabile ma non passerebbe la validazione:
   * la versione (5) e la variante devono stare in bit precisi, e uno schema che
   * accetta solo UUID rifiuterebbe l'impronta grezza.
   */
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;

  const hex = hash.subarray(0, 16).toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
