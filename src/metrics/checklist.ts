import type {
  Impediment,
  Retrospective,
  Sprint,
  SprintScopeEvent,
  SprintStatistics,
  StateTransition,
} from "@/domain";

/**
 * La checklist dello Scrum Master del capitolo 16.
 *
 * Trascritta dal testo (pag. 163), in tre momenti: inizio dello sprint, ogni
 * giorno, fine dello sprint. Il libro la chiude così:
 *
 * > «Nice little checklist. Although over time, as Scrum master, try to make
 * > yourself **redundant**. Coach the team to do these things without you.»
 *
 * **Metà delle voci non è automatizzabile, ed è una proprietà del lavoro dello
 * Scrum Master, non un limite del portale.** «Stampa la pagina e appendila al
 * muro» e «assicurati che il daily scrum inizi in orario» non lasciano traccia
 * in nessun database. Vengono mostrate lo stesso, marcate come umane: una
 * checklist che le spuntasse da sola starebbe mentendo, e una che le omettesse
 * farebbe sembrare il lavoro dello Scrum Master più piccolo di quanto sia.
 *
 * Pura e senza I/O come il resto del motore, e non legge mai l'orologio.
 */

/** When in the sprint's life a checklist entry applies. */
export type ChecklistMoment = "start" | "daily" | "end";

/**
 * How an entry stands.
 *
 * `human` is not a failure and not a success: it is a statement about what a
 * database can know. Collapsing it into either would be the lie this module
 * exists to avoid.
 */
export type ChecklistStatus = "done" | "todo" | "human" | "not-yet";

export interface ChecklistEntry {
  readonly id: string;
  readonly moment: ChecklistMoment;
  /** The entry as the book states it, translated. */
  readonly text: string;
  readonly status: ChecklistStatus;
  /** Why the portal says what it says — a figure, or the reason it cannot tell. */
  readonly detail: string;
}

export interface ChecklistInput {
  readonly sprint: Sprint;
  readonly transitions: readonly StateTransition[];
  readonly scopeEvents: readonly SprintScopeEvent[];
  readonly impediments: readonly Impediment[];
  readonly retrospectives: readonly Retrospective[];
  readonly statistics: readonly SprintStatistics[];
  /** The instant the checklist is read at, passed in so the engine stays pure. */
  readonly asOf: Date;
}

/**
 * How recently the board must have moved for "kept up to date" to hold.
 *
 * Two days rather than one: a sprint that spans a weekend would otherwise
 * report a stale board every Monday morning, which is a fact about the calendar
 * and not about the team.
 */
const BOARD_FRESHNESS_DAYS = 2;

/**
 * How many days before the end the demo has to be announced.
 *
 * > «Everyone should be notified about the demo **a day or two before**.»
 * > (pag. 163)
 *
 * Two, which is the later of the two the book allows: a reminder that fires on
 * the last possible day is one that arrives too late for anyone to rearrange an
 * afternoon.
 */
const DEMO_NOTICE_DAYS = 2;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Builds the checklist for one sprint.
 *
 * Every entry always appears, in the book's order, whatever its status. A
 * checklist that hid what it could not verify would let the human half of the
 * job disappear quietly, and that half is the job.
 */
export function scrumMasterChecklist(input: ChecklistInput): readonly ChecklistEntry[] {
  const { sprint, asOf } = input;

  const forSprint = input.scopeEvents.filter((event) => event.sprintId === sprint.id);
  const closed = sprint.completedAt !== null;
  const started = asOf.getTime() >= sprint.startsAt.getTime();

  const statistics = input.statistics.find((entry) => entry.sprintId === sprint.id);
  const retrospective = input.retrospectives.find((entry) => entry.sprintId === sprint.id);

  const openImpediments = input.impediments.filter(
    (entry) => entry.resolvedAt === null && entry.raisedAt.getTime() <= asOf.getTime(),
  );

  /*
   * L'ultimo movimento sulla lavagna.
   *
   * Non «quante transizioni ci sono», ma «quando è stata l'ultima»: una
   * squadra che ha aggiornato molto la settimana scorsa e nulla da tre giorni
   * ha una lavagna ferma, e il conteggio totale non lo direbbe.
   */
  const lastMove = input.transitions
    .filter((entry) => entry.occurredAt.getTime() <= asOf.getTime())
    .reduce<Date | null>(
      (latest, entry) =>
        latest === null || entry.occurredAt.getTime() > latest.getTime()
          ? entry.occurredAt
          : latest,
      null,
    );

  const daysToEnd = calendarDaysBetween(asOf, sprint.endsAt);

  const entries: ChecklistEntry[] = [
    {
      id: "info-page",
      moment: "start",
      text: "Dopo la pianificazione, creare la pagina informativa dello sprint.",
      status: sprint.goal === null ? "todo" : "done",
      detail:
        sprint.goal === null
          ? "Manca l'obiettivo dello sprint: senza, la pagina non ha nulla da comunicare."
          : "Generata dai dati dello sprint: obiettivo, elementi, date e cerimonie.",
    },
    {
      id: "wiki-link",
      moment: "start",
      text: "Collegare la pagina dalla bacheca aziendale.",
      status: "human",
      // La bacheca del libro è un wiki, che sta fuori da qui: un portale non
      // può sapere se un collegamento sia stato messo altrove.
      detail: "La bacheca aziendale è fuori dal portale.",
    },
    {
      id: "print",
      moment: "start",
      text: "Stampare la pagina e appenderla dove la squadra passa.",
      status: "human",
      detail: "Nessun database può saperlo, e va bene così.",
    },
    {
      id: "announce",
      moment: "start",
      text: "Annunciare a tutti l'inizio dello sprint, con obiettivo e collegamento.",
      status: "human",
      detail: "Il portale non manda posta.",
    },
    {
      id: "statistics-start",
      moment: "start",
      text: "Registrare nelle statistiche velocity stimata, dimensione della squadra e durata.",
      status: statistics ? "done" : "todo",
      detail: statistics
        ? `Previsione di ${statistics.forecastPoints} punti, registrata il ${formatDay(statistics.recordedAt)}.`
        : "Nessuna previsione registrata per questo sprint.",
    },
    {
      id: "daily-on-time",
      moment: "daily",
      text: "Il daily scrum inizia e finisce in orario.",
      status: "human",
      detail: "Nessun dato lo registra.",
    },
    {
      id: "scope-adjusted",
      moment: "daily",
      text: "Elementi aggiunti o tolti per tenere lo sprint in carreggiata.",
      status: forSprint.some((event) => event.occurredAt.getTime() > sprint.startsAt.getTime())
        ? "done"
        : "todo",
      detail: describeScope(forSprint, sprint),
    },
    {
      id: "po-informed",
      moment: "daily",
      text: "Il Product Owner è informato di quei cambiamenti.",
      status: "human",
      detail: "È una conversazione, non un record.",
    },
    {
      id: "board-fresh",
      moment: "daily",
      text: "Backlog di sprint e burndown tenuti aggiornati dalla squadra.",
      status: boardFreshness(lastMove, asOf, started),
      detail:
        lastMove === null
          ? "Nessun movimento registrato."
          : `Ultimo movimento sulla lavagna il ${formatDay(lastMove)}.`,
    },
    {
      id: "impediments",
      moment: "daily",
      text: "Gli impedimenti sono risolti o segnalati.",
      status: openImpediments.length === 0 ? "done" : "todo",
      detail:
        openImpediments.length === 0
          ? "Nessun impedimento aperto."
          : // «1 impedimenti» fa sembrare generato un testo che invece è scritto.
            `${openImpediments.length} ${openImpediments.length === 1 ? "impedimento ancora aperto" : "impedimenti ancora aperti"}.`,
    },
    {
      id: "demo",
      moment: "end",
      text: "Fare una demo aperta.",
      status: "human",
      detail: "Il portale non sa se una riunione sia avvenuta.",
    },
    {
      id: "demo-notice",
      moment: "end",
      text: "Avvisare tutti della demo un giorno o due prima.",
      status: demoNotice(daysToEnd, closed),
      detail: describeDemoNotice(daysToEnd, closed, sprint),
    },
    {
      id: "retrospective",
      moment: "end",
      text: "Tenere la retrospettiva con squadra e Product Owner.",
      status: closed ? (retrospective ? "done" : "todo") : "not-yet",
      detail: closed
        ? retrospective
          ? `Tenuta il ${formatDay(retrospective.heldAt)}, con ${retrospective.participantCount} partecipanti.`
          : "Lo sprint è chiuso e non risulta alcuna retrospettiva."
        : "Lo sprint non è ancora chiuso.",
    },
    {
      id: "statistics-end",
      moment: "end",
      text: "Aggiornare le statistiche con velocity effettiva e punti chiave della retrospettiva.",
      /*
       * Entrambe le metà, e nessuna delle due si «aggiorna».
       *
       * La velocity effettiva si ricalcola sempre dai dati — è una proprietà
       * derivata, non un campo da riempire. I punti chiave della retrospettiva
       * ora compaiono accanto alle statistiche, letti dall'entità che li
       * contiene invece che ricopiati: nel libro si trascrivono su un wiki, e
       * una trascrizione diverge dall'originale alla prima correzione.
       *
       * Resta «da fare» finché la retrospettiva non è stata tenuta: è l'unica
       * metà che qualcuno deve ancora fare.
       */
      status: closed ? (retrospective ? "done" : "todo") : "not-yet",
      detail: closed
        ? retrospective
          ? "Velocity effettiva e punti chiave della retrospettiva compaiono entrambi nelle statistiche."
          : "Manca la retrospettiva: senza, le statistiche restano senza i suoi punti chiave."
        : "Lo sprint non è ancora chiuso.",
    },
  ];

  return entries;
}

/**
 * Whole days between two instants, counted on the **calendar**.
 *
 * Not elapsed milliseconds divided by a day, which is what the first version
 * did and got wrong. On the 15th at 09:00, a sprint ending on the 17th at 17:00
 * is 2,33 days away in milliseconds — and rounding that up says "3 days", while
 * a person looking at a calendar says "the day after tomorrow", which is two.
 *
 * The book's rule is stated in human days — «a day or two before» — so the
 * arithmetic has to be in human days too, or the reminder fires on the wrong
 * morning.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const startOfDay = (instant: Date): number =>
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());

  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

function boardFreshness(
  lastMove: Date | null,
  asOf: Date,
  started: boolean,
): ChecklistStatus {
  if (!started) return "not-yet";
  if (lastMove === null) return "todo";

  return asOf.getTime() - lastMove.getTime() <= BOARD_FRESHNESS_DAYS * DAY ? "done" : "todo";
}

function demoNotice(daysToEnd: number, closed: boolean): ChecklistStatus {
  if (closed) return "human";
  // Fuori dalla finestra non è «da fare»: è presto, e un avviso che compare
  // per due settimane insegna a ignorarlo.
  return daysToEnd <= DEMO_NOTICE_DAYS && daysToEnd >= 0 ? "todo" : "not-yet";
}

function describeDemoNotice(daysToEnd: number, closed: boolean, sprint: Sprint): string {
  if (closed) return "Sprint chiuso.";
  if (daysToEnd < 0) return "La data di fine è passata.";

  return daysToEnd <= DEMO_NOTICE_DAYS
    ? `Lo sprint finisce fra ${daysToEnd === 0 ? "oggi" : `${daysToEnd} giorni`}: è il momento.`
    : `Lo sprint finisce il ${formatDay(sprint.endsAt)}: non ancora.`;
}

function describeScope(events: readonly SprintScopeEvent[], sprint: Sprint): string {
  const after = events.filter(
    (event) => event.occurredAt.getTime() > sprint.startsAt.getTime(),
  );

  if (after.length === 0) return "Nessun movimento dopo l'inizio.";

  const added = after.filter((event) => event.kind === "added").length;
  const removed = after.length - added;

  return `${added} ingressi e ${removed} uscite dopo l'inizio.`;
}

/** A day, in the form the rest of the interface uses. */
function formatDay(instant: Date): string {
  return instant.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** The three moments, in the order the book lists them. */
export const CHECKLIST_MOMENTS: readonly ChecklistMoment[] = ["start", "daily", "end"];

export const CHECKLIST_MOMENT_LABELS: Readonly<Record<ChecklistMoment, string>> = {
  start: "All'inizio dello sprint",
  daily: "Ogni giorno",
  end: "Alla fine dello sprint",
};

export const CHECKLIST_STATUS_LABELS: Readonly<Record<ChecklistStatus, string>> = {
  done: "fatto",
  todo: "da fare",
  human: "lo sa solo chi c'era",
  "not-yet": "non ancora",
};
