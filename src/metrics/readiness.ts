import type { WorkItem } from "@/domain";

/**
 * Definition of Ready: quando una storia è pronta per entrare in uno sprint.
 *
 * > «So definition of done is a checklist for when a story is **done**, and
 * > definition of ready is a checklist for when a story is **ready to be pulled
 * > into a sprint**. Very useful.» (cap. 4, 2ª ed.)
 *
 * Il libro dà anche la tecnica più semplice, ed è quella che rende questa
 * metrica possibile invece che un elenco di buone intenzioni:
 *
 * > «The simplest technique is simply to make sure that **all the fields are
 * > filled in** for each story (or more specifically, for each story that has
 * > high enough importance to be considered for this sprint).»
 *
 * E il suo esempio è esattamente un campo mancante: «This story named "Add
 * user", there is no estimate for that. Let's estimate!»
 *
 * **Il portale ne verifica solo la parte verificabile, e lo dichiara.** Che una
 * storia sia *compresa* dalla squadra non è deducibile da un database, e una
 * spunta verde su quello sarebbe una bugia. Che abbia una stima, un modo di
 * essere dimostrata e una posizione, invece, è un fatto — e sono i tre campi
 * che il libro nomina.
 *
 * Puro e senza I/O come il resto del motore, e non legge mai l'orologio.
 */

/** A field the book asks to be filled before a story is pulled into a sprint. */
export type ReadinessRequirement = "estimate" | "how-to-demo" | "backlog-position";

export const READINESS_REQUIREMENTS: readonly ReadinessRequirement[] = [
  "estimate",
  "how-to-demo",
  "backlog-position",
];

export interface ItemReadiness {
  readonly itemId: WorkItem["id"];
  readonly title: string;

  /** What is missing. Empty means ready on everything the portal can check. */
  readonly missing: readonly ReadinessRequirement[];
}

export interface ReadinessCheck {
  /** How far down the backlog the check was run: the book checks the top. */
  readonly considered: number;
  readonly ready: number;
  readonly notReady: readonly ItemReadiness[];
}

/**
 * Checks the top of an **already ordered** backlog against the fields the book
 * names.
 *
 * `depth` is how many items to look at, because the book is explicit that the
 * check is for the stories «that ha[ve] high enough importance to be considered
 * for this sprint» — running it over a whole backlog would report a hundred
 * unready stories nobody was going to start, and an alert nobody can act on is
 * an alert people learn to skip.
 *
 * A depth of zero or less considers nothing, and says so through `considered`.
 */
export function readinessCheck(
  orderedBacklog: readonly WorkItem[],
  depth: number,
): ReadinessCheck {
  const top = orderedBacklog.slice(0, Math.max(0, Math.trunc(depth)));

  const notReady: ItemReadiness[] = [];

  for (const item of top) {
    const missing: ReadinessRequirement[] = [];

    // «There is no estimate for that. Let's estimate!» — l'esempio del libro.
    if (item.estimate === null) missing.push("estimate");
    if (item.howToDemo === null) missing.push("how-to-demo");

    /*
     * Senza posizione non è collocata.
     *
     * Il libro definisce il perimetro del controllo proprio con l'ordine —
     * «high enough importance to be considered for this sprint» — quindi una
     * storia senza posizione non è solo incompleta: non si sa nemmeno se
     * dovesse essere guardata.
     */
    if (item.backlogOrder === null) missing.push("backlog-position");

    if (missing.length > 0) notReady.push({ itemId: item.id, title: item.title, missing });
  }

  return { considered: top.length, ready: top.length - notReady.length, notReady };
}

/** How each requirement is named to a reader, in the book's own terms. */
export const READINESS_LABELS: Readonly<Record<ReadinessRequirement, string>> = {
  estimate: "senza stima",
  "how-to-demo": "senza «come si dimostra»",
  "backlog-position": "senza posizione in backlog",
};
