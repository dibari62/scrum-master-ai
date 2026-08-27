import type { Sprint, SprintScopeEvent, StateTransition, WorkItem } from "@/domain";
import { compareBacklogOrder } from "@/domain";

import { groupByWorkItem, stateAt } from "./history";
import { membershipEntriesAt } from "./sprint";
import type { ChecklistStatus } from "./checklist";

/**
 * La demo di sprint del capitolo 9.
 *
 * Il libro è categorico sul fatto che la demo si faccia:
 *
 * > «Sprint demos, when done right, are extremely important. […] The team gets
 * > credit for their accomplishment. They feel good.»
 *
 * E dà sei regole su come condurla (pag. 82). Quattro riguardano il **modo** —
 * ritmo, taglio, linguaggio — e nessun database le può verificare. Le altre due
 * sono decisioni su **che cosa** portare in sala, e quelle sono fatti sui dati
 * dello sprint: l'obiettivo da presentare per primo, e la divisione fra ciò che
 * si mostra e ciò che si nomina soltanto.
 *
 * > «Don't demonstrate a bunch of minor bug fixes and trivial features.
 * > **Mention them but don't demo them**, since that generally takes too long
 * > and detracts focus from the more important stories.»
 *
 * Da qui la scaletta: due elenchi, non uno. Il portale non decide se una demo
 * sia stata fatta bene — decide quali elementi finiti meritano di essere
 * mostrati e quali vanno solo nominati, che è esattamente la scelta su cui il
 * libro dice che le demo si perdono.
 *
 * C'è poi il dialogo su «indemonstrable stuff», dove lo Scrum Master smonta la
 * frase «questa storia non si può dimostrare» chiedendo *come fai a sapere che
 * è finita*. La risposta è sempre un modo di dimostrarla, ed è il campo
 * `howToDemo`: una storia in scaletta senza quel campo è una storia che alla
 * demo verrà raccontata a parole.
 *
 * Puro e senza I/O come il resto del motore, e non legge mai l'orologio.
 */

/** What the book does with an item at the demo. */
export type DemoTreatment = "demo" | "mention";

export interface DemoAgendaEntry {
  readonly itemId: WorkItem["id"];
  readonly title: string;
  readonly kind: WorkItem["kind"];
  readonly treatment: DemoTreatment;

  /** The «how to demo» text, or `null` when nobody wrote one. */
  readonly howToDemo: string | null;
}

export interface DemoAgenda {
  /** «Make sure you clearly present the sprint goal.» */
  readonly goal: string | null;

  /** What to show, in backlog order: the important stories first. */
  readonly toDemo: readonly DemoAgendaEntry[];

  /** What to name without showing: fixes and small change. */
  readonly toMention: readonly DemoAgendaEntry[];

  /** Of the items to show, those with no «how to demo» written. */
  readonly withoutHowToDemo: readonly DemoAgendaEntry[];
}

export interface DemoAgendaInput {
  readonly sprint: Sprint;
  readonly items: readonly WorkItem[];
  readonly transitions: readonly StateTransition[];
  readonly scopeEvents: readonly SprintScopeEvent[];
}

/**
 * Which kinds the book keeps off the stage.
 *
 * `bug` because «minor bug fixes» is the book's own first example. `task`
 * because a task is a slice of a story, not a thing a stakeholder recognises —
 * demoing it would show plumbing. `spike` because its output is an answer, not
 * running code, and «focus on demonstrating actual working code» is the rule
 * right above.
 *
 * Stories and epics stay: those are what the audience came for.
 */
const MENTION_ONLY: ReadonlySet<WorkItem["kind"]> = new Set(["bug", "task", "spike"]);

/**
 * Builds the agenda of a sprint demo from what actually got finished.
 *
 * «Finished» is the same question velocity asks — was the item in `done` at the
 * closing instant — and deliberately so. A demo that showed something velocity
 * did not count would be showing work the team is not being credited for, and
 * the two numbers would tell different stories about the same sprint.
 *
 * Order is backlog order, so the most important story is demoed while the room
 * is still paying attention.
 */
export function demoAgenda(input: DemoAgendaInput): DemoAgenda {
  const { sprint } = input;

  const closingInstant = sprint.completedAt ?? sprint.endsAt;
  const entries = membershipEntriesAt(input.scopeEvents, sprint, closingInstant);
  const byItem = groupByWorkItem(input.transitions);

  const completed = input.items
    .filter((item) => entries.has(item.id))
    .filter((item) => stateAt(byItem.get(item.id) ?? [], closingInstant) === "done");

  const agenda = [...completed].sort(compareBacklogOrder).map(
    (item): DemoAgendaEntry => ({
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      treatment: MENTION_ONLY.has(item.kind) ? "mention" : "demo",
      howToDemo: item.howToDemo,
    }),
  );

  const toDemo = agenda.filter((entry) => entry.treatment === "demo");

  return {
    goal: sprint.goal,
    toDemo,
    toMention: agenda.filter((entry) => entry.treatment === "mention"),
    withoutHowToDemo: toDemo.filter((entry) => entry.howToDemo === null),
  };
}

/** How each treatment is named to a reader. */
export const DEMO_TREATMENT_LABELS: Readonly<Record<DemoTreatment, string>> = {
  demo: "da mostrare",
  mention: "da nominare",
};

export interface DemoChecklistEntry {
  readonly id: string;
  /** The entry as the book states it, translated. */
  readonly text: string;
  readonly status: ChecklistStatus;
  /** Why the portal says what it says — a figure, or the reason it cannot tell. */
  readonly detail: string;
}

/**
 * The six rules of pag. 82, in the book's order.
 *
 * Only two of them leave a trace in a database, and the other four are shown
 * marked as human for the same reason as in the chapter 16 checklist: hiding
 * what cannot be verified would make the job look smaller than it is. «Keep a
 * high pace» is advice to a person in a room, and no amount of software turns
 * it into a green tick.
 *
 * Takes the same input as the agenda and rebuilds it, rather than receiving one
 * already built. The two would otherwise be able to disagree — a caller passing
 * an agenda from a different sprint would get a checklist that looks right and
 * describes something else — and rebuilding a handful of items costs nothing.
 */
export function demoChecklist(input: DemoAgendaInput): readonly DemoChecklistEntry[] {
  const agenda = demoAgenda(input);
  const missing = agenda.withoutHowToDemo.length;

  return [
    {
      id: "goal",
      text: "Presentare chiaramente l'obiettivo dello sprint.",
      status: agenda.goal === null ? "todo" : "done",
      detail:
        agenda.goal === null
          ? "Lo sprint non ha un obiettivo scritto: non c'è nulla da presentare."
          : agenda.goal,
    },
    {
      id: "preparation",
      text: "Non passare troppo tempo a preparare la demo, men che meno le slide.",
      status: "human",
      detail: "«Cut the crap out and just focus on demonstrating actual working code.»",
    },
    {
      id: "pace",
      text: "Tenere un ritmo alto: veloce, non bella.",
      status: "human",
      detail: "Il portale non sa quanto sia durata una riunione.",
    },
    {
      id: "business-level",
      text: "Restare sul piano dell'utente: cosa abbiamo fatto, non come.",
      status: "human",
      detail: "«Focus on what did we do rather than how did we do it.»",
    },
    {
      id: "hands-on",
      text: "Se possibile, far provare il prodotto ai presenti.",
      status: "human",
      detail: "Nessun dato lo registra.",
    },
    {
      id: "minor-fixes",
      text: "Non dimostrare correzioni minori: nominarle e basta.",
      // Questa il portale la prepara: la scaletta è già divisa in due.
      status: agenda.toMention.length === 0 ? "not-yet" : "done",
      detail:
        agenda.toMention.length === 0
          ? "Nessun elemento minore da nominare in questo sprint."
          : `${agenda.toDemo.length} da mostrare, ${agenda.toMention.length} solo da nominare.`,
    },
    {
      id: "how-to-demo",
      /*
       * Non è una delle sei: è il dialogo su «indemonstrable stuff» che segue
       * la checklist, e vale la pena dirlo invece di farlo passare per testo
       * del libro.
       */
      text: "Ogni elemento in scaletta ha scritto come si dimostra. (Nostra, dal dialogo di pag. 82.)",
      status: agenda.toDemo.length === 0 ? "not-yet" : missing === 0 ? "done" : "todo",
      detail:
        agenda.toDemo.length === 0
          ? "Nessun elemento da mostrare."
          : missing === 0
            ? "Tutti gli elementi da mostrare hanno il «come si dimostra»."
            : `${missing} ${missing === 1 ? "elemento" : "elementi"} in scaletta senza «come si dimostra».`,
    },
  ];
}
