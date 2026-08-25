/**
 * The narrative the synthetic data tells.
 *
 * Four sprints of a checkout rework, deteriorating in a way anyone who has run
 * a team will recognise. Kept declarative and separate from the generator so
 * the story can be read and argued about without reading the code that renders
 * it.
 *
 * The anomalies are deliberate. A data set showing a healthy team proves
 * nothing: the product exists to notice trouble, so the demo data must contain
 * trouble worth noticing — and each one must be visible in a *different*
 * metric, otherwise a single lucky calculation would appear to find them all.
 */

import { addDays, mondayOnOrBefore } from "./calendar";

export type SprintPlan = {
  readonly name: string;
  readonly goal: string;

  /** Items planned before the sprint starts. */
  readonly plannedItems: number;

  /**
   * Items added after it started.
   *
   * Feeds `scopeChange`, and only counts when added strictly after the start
   * instant: work present at the start is the commitment, not a change to it.
   */
  readonly addedMidSprint: number;

  /**
   * Share of planned work that does not finish.
   *
   * Rising across the four sprints, which is what makes `carryOver` tell a
   * story rather than report a number.
   */
  readonly incompleteShare: number;

  /**
   * Hours an item waits in review before anyone looks at it.
   *
   * The bottleneck of sprint 3. It shows up in `reviewWaitTime` and in flow
   * efficiency, while cycle time only reflects it indirectly — which is the
   * point: a team can look busy while nothing gets finished.
   */
  readonly reviewWaitHours: readonly [min: number, max: number];

  /** Items that spend time in `blocked`, and for how many days. */
  readonly blockedItems: number;
  readonly blockedDays: readonly [min: number, max: number];

  /** Items that reach `done` and come back. Feeds `reopenRate`. */
  readonly reopenedItems: number;

  /**
   * Items re-estimated **after** they entered the sprint, and by how much.
   *
   * A deliberate anomaly, like the review bottleneck and the growing carry-over.
   * It exists so that one rule of the book can actually be observed rather than
   * merely asserted: velocity counts the estimate an item carried when it
   * entered the sprint, and «any updates to the story time estimates done
   * during the sprint are ignored» (pag. 29).
   *
   * Without a single re-estimate in the data, that rule and its absence produce
   * identical numbers — so the defect it fixes would have been invisible, and
   * so would a future regression.
   *
   * Upwards, because that is what happens: a story turns out to be bigger than
   * it looked. It is also the direction that flatters nobody, so a burndown
   * that quietly used the new figure would show the team finishing *less*
   * work than it did.
   */
  readonly reEstimatedItems: number;
  readonly reEstimateFactor: number;
};

/**
 * Two-week sprints, starting on a Monday.
 *
 * **The dates are not fixed, and that is a decision.** They used to be: the
 * first sprint began on 6 April 2026 and the last ended on 31 May. Read in
 * August, that data set had no sprint in progress — so a judgement about the
 * *current* sprint could only ever report "there isn't one". Correct, and
 * useless for seeing whether the feature works.
 *
 * The sprints are now placed backwards from a reference instant the caller
 * supplies, so the last one is always in flight. The instant is passed in and
 * never read from the clock, for the same reason the metrics engine does not
 * read it: a generator that consults `Date.now()` produces a different data set
 * on every run and cannot be tested (ADR-0002).
 */
export const SPRINT_LENGTH_DAYS = 14;

/**
 * How far back the last sprint starts from the reference instant, before the
 * Monday alignment is applied.
 *
 * Six days rather than seven so the alignment can only ever move the start
 * *earlier*, never past the instant itself. With this value the reference
 * instant lands between roughly 45% and 97% of the way through the last sprint:
 * always started, never finished, and always far enough in for progress against
 * elapsed time to mean something.
 */
const LAST_SPRINT_MINIMUM_ELAPSED_DAYS = 6;

/**
 * Where the story begins, given the instant it is read at.
 *
 * Deterministic: the same instant always yields the same dates, which is what
 * lets the integration tests assert on a generated data set at all.
 */
export function firstSprintStart(asOf: Date): Date {
  const lastStart = mondayOnOrBefore(addDays(asOf, -LAST_SPRINT_MINIMUM_ELAPSED_DAYS));

  return addDays(lastStart, -(SPRINT_PLANS.length - 1) * SPRINT_LENGTH_DAYS);
}

export const SPRINT_PLANS: readonly SprintPlan[] = [
  {
    name: "Sprint 1 — Fondamenta del carrello",
    goal: "Il carrello conserva gli articoli fra una sessione e l'altra.",
    plannedItems: 9,
    addedMidSprint: 0,
    incompleteShare: 0.11,
    reviewWaitHours: [2, 8],
    blockedItems: 0,
    blockedDays: [0, 0],
    reopenedItems: 0,
    reEstimatedItems: 0,
    reEstimateFactor: 1,
  },
  {
    // Il perimetro cresce: arrivano richieste a sprint iniziato.
    name: "Sprint 2 — Metodi di pagamento",
    goal: "Si paga con carta e con PayPal.",
    plannedItems: 10,
    addedMidSprint: 4,
    incompleteShare: 0.2,
    reviewWaitHours: [4, 12],
    blockedItems: 1,
    blockedDays: [1, 2],
    reopenedItems: 1,
    // Due storie si rivelano più grosse di come sembravano.
    reEstimatedItems: 2,
    reEstimateFactor: 2,
  },
  {
    // La revisione si ingolfa: il lavoro procede ma non si chiude.
    name: "Sprint 3 — Indirizzi e spedizione",
    goal: "L'utente sceglie indirizzo e modalità di spedizione.",
    plannedItems: 11,
    addedMidSprint: 2,
    incompleteShare: 0.36,
    reviewWaitHours: [36, 96],
    blockedItems: 2,
    blockedDays: [2, 4],
    reopenedItems: 2,
    reEstimatedItems: 2,
    reEstimateFactor: 2,
  },
  {
    // Il trascinato dei tre sprint precedenti presenta il conto.
    name: "Sprint 4 — Conferma d'ordine",
    goal: "L'ordine si conclude e arriva la conferma via email.",
    plannedItems: 12,
    addedMidSprint: 3,
    incompleteShare: 0.42,
    reviewWaitHours: [48, 120],
    blockedItems: 3,
    blockedDays: [3, 9],
    reopenedItems: 2,
    reEstimatedItems: 3,
    reEstimateFactor: 3,
  },
];

/**
 * Fictional people (§8.2).
 *
 * Names invented for this data set; any resemblance to colleagues or customers
 * would be a defect, not a coincidence. Addresses use the reserved
 * `example.invalid` domain so a stray email cannot reach anyone.
 */
export const TEAM = [
  { name: "Giulia Rossi", mailbox: "giulia.rossi" },
  { name: "Marco Bianchi", mailbox: "marco.bianchi" },
  { name: "Sofia Greco", mailbox: "sofia.greco" },
  { name: "Luca Ferrara", mailbox: "luca.ferrara" },
  { name: "Elena Costa", mailbox: "elena.costa" },
] as const;

/** Board columns, and the canonical state each one maps to. */
export const BOARD_COLUMNS = [
  { name: "Da fare", state: "todo", wipLimit: null },
  { name: "In lavorazione", state: "in_progress", wipLimit: 4 },
  { name: "In revisione", state: "in_review", wipLimit: 3 },
  { name: "Bloccato", state: "blocked", wipLimit: null },
  { name: "Fatto", state: "done", wipLimit: null },
] as const;

/**
 * Titles drawn on to name work items.
 *
 * Chosen to read like a real backlog: a mix of features, defects and chores,
 * concrete enough that a report quoting one of them sounds plausible.
 *
 * **There have to be more of these than a project has items.** The generator
 * walks the list and wraps around, so a short list makes the same title appear
 * three times in one backlog — and a reader looking at the items page sees what
 * looks like duplicated data. The rows were always distinct, with different
 * sprints and different histories, but demonstration data that *looks* broken
 * costs the same as data that is broken. `seed.test.ts` fails if the list stops
 * covering the largest scenario.
 */
export const ITEM_TITLES: readonly string[] = [
  "Salvataggio del carrello fra sessioni",
  "Calcolo delle imposte per paese",
  "Applicazione dei codici sconto",
  "Riepilogo ordine prima del pagamento",
  "Validazione della carta di credito",
  "Integrazione con il fornitore di pagamenti",
  "Gestione del pagamento rifiutato",
  "Selezione dell'indirizzo di spedizione",
  "Stima dei tempi di consegna",
  "Email di conferma dell'ordine",
  "Ripristino del carrello dopo errore di rete",
  "Messaggi di errore comprensibili nel modulo",
  "Accessibilità da tastiera nel checkout",
  "Registro degli eventi di pagamento",
  "Timeout della sessione di pagamento",
  "Arrotondamento degli importi in valuta",
  "Rimozione articolo esaurito dal carrello",
  "Indicatore di avanzamento del checkout",
  "Pagamento con portafoglio digitale",
  "Salvataggio dei metodi di pagamento ricorrenti",
  "Verifica dell'indirizzo tramite servizio postale",
  "Ritiro in negozio come alternativa alla spedizione",
  "Calcolo delle spese di spedizione per peso",
  "Soglia di spedizione gratuita",
  "Gestione dei codici sconto scaduti",
  "Limite di quantità per singolo articolo",
  "Avviso di disponibilità in esaurimento",
  "Ordinamento degli articoli nel riepilogo",
  "Modifica della quantità dal riepilogo",
  "Rimozione di un articolo dal riepilogo",
  "Conferma di abbandono del carrello",
  "Ripresa di un ordine interrotto",
  "Fattura in formato PDF allegata alla conferma",
  "Richiesta di fattura con partita IVA",
  "Selezione della valuta di pagamento",
  "Conversione valuta al tasso del giorno",
  "Blocco degli ordini verso paesi non serviti",
  "Consenso al trattamento dei dati al checkout",
  "Informativa sui cookie nel processo di acquisto",
  "Registrazione facoltativa dopo l'acquisto",
  "Acquisto come ospite senza account",
  "Recupero del carrello via email",
  "Notifica di spedizione avvenuta",
  "Tracciamento della spedizione nel dettaglio ordine",
  "Gestione della consegna fallita",
  "Avvio di una richiesta di reso",
  "Rimborso parziale di un ordine",
  "Storno di un pagamento autorizzato",
  "Doppio addebito segnalato dal fornitore",
  "Riconciliazione fra ordine e incasso",
  "Esportazione degli ordini per la contabilità",
  "Prova di carico sul modulo di pagamento",
  "Riduzione dei tempi di risposta del riepilogo",
  "Registro degli accessi al pannello ordini",
  "Ruoli e permessi sul pannello ordini",
  "Ricerca di un ordine per numero",
  "Filtro degli ordini per stato",
  "Annullamento di un ordine non ancora spedito",
  "Modifica dell'indirizzo dopo la conferma",
  "Segnalazione di indirizzo incompleto",
];

