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
};

/**
 * Two-week sprints, starting on a Monday.
 *
 * The dates are in the past relative to any plausible demo, so the data set
 * never contains a sprint that has not happened yet — which would make
 * burndown and velocity meaningless.
 */
export const SPRINT_LENGTH_DAYS = 14;

export const FIRST_SPRINT_START = new Date("2026-04-06T08:00:00.000Z");

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
];
