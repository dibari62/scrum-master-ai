import type { AgentPersona, AgentStatus, AutonomyLevel, SkillKey } from "@/domain";

/**
 * The words this feature uses, in one place.
 *
 * **Why a file for wording.** The creation wizard explained every term —
 * «Osserva — raccoglie e mostra, non scrive nulla» — and the card you live with
 * afterwards showed the same value stripped to a bare «Osserva». The
 * explanation existed and was thrown away at exactly the moment it was needed,
 * because it had been written inline in the form and nothing connected the two
 * screens.
 *
 * Kept as `{ label, explanation }` rather than one pre-joined string so each
 * screen can render them the way it needs: a `<select>` wants them on one line,
 * a card wants the explanation underneath.
 */

export type Term = {
  readonly label: string;
  /** One sentence, in the reader's terms. Never a restatement of the label. */
  readonly explanation: string;
};

/** Joined for the places that can only show a single line, like an `<option>`. */
export function inline(term: Term): string {
  return `${term.label} — ${term.explanation}`;
}

export const PERSONA: Readonly<Record<AgentPersona, Term>> = {
  facilitator: {
    label: "Facilitatore",
    explanation: "aiuta la squadra a rimuovere gli ostacoli",
  },
  flow_analyst: {
    label: "Analista di flusso",
    explanation: "guarda dove il lavoro si ferma",
  },
  stakeholder_communicator: {
    label: "Comunicatore",
    explanation: "racconta lo stato a chi sta fuori dalla squadra",
  },
};

export const AUTONOMY: Readonly<Record<AutonomyLevel, Term>> = {
  observe: {
    label: "Osserva",
    explanation: "raccoglie e mostra, non scrive nulla",
  },
  report: {
    label: "Riferisce",
    explanation: "produce resoconti dentro l'applicazione, e nient'altro",
  },
  advise: {
    label: "Consiglia",
    explanation: "propone azioni, che restano da approvare",
  },
  act_with_approval: {
    label: "Agisce con approvazione",
    explanation: "esegue solo dopo un consenso esplicito",
  },
  autonomous: {
    label: "Autonomo",
    explanation: "agisce da solo",
  },
};

export const STATUS: Readonly<Record<AgentStatus, Term>> = {
  active: {
    label: "Attivo",
    explanation: "può eseguire le capacità che ha abilitate",
  },
  suspended: {
    label: "Sospeso",
    explanation: "non esegue nulla finché non viene riattivato",
  },
};

/**
 * A capability, described by what it gives you rather than by what it is.
 *
 * `sprint-report` is the stable identifier and must never be renamed — it is
 * persisted on every enablement and every run. It is also meaningless to a
 * reader, which is why it was the wrong thing to print on the card.
 */
export type SkillDescription = {
  readonly name: string;
  /** What the reader gets out of it. */
  readonly produces: string;
};

/**
 * Whether this release can run a skill is **not** declared here.
 *
 * It is `isSkillAvailable` in `src/domain`, and it is the same answer the server
 * action consults before switching anything on. This file used to carry its own
 * `available` flag beside each description: the two drifted, and the visible
 * symptom was a capability the card described as ready while pressing its button
 * did nothing at all — the action was refusing a key the domain did not list.
 */
export const SKILLS: Readonly<Record<SkillKey, SkillDescription>> = {
  "configuration-check": {
    name: "Prova del collegamento",
    produces:
      "controlla che il collegamento al modello linguistico funzioni. Non legge i dati del progetto e non produce nulla da leggere: serve a chi installa.",
  },
  "sprint-report": {
    name: "Resoconto di sprint",
    produces:
      "racconta com'è andato uno sprint concluso, citando soltanto i numeri calcolati dal codice.",
  },
  "daily-digest": {
    name: "Digest giornaliero",
    produces: "cosa è cambiato ieri, cosa non si è mosso e cosa è fermo.",
  },
  "sprint-health": {
    name: "Salute dello sprint",
    produces:
      "spiega il giudizio sullo sprint in corso: mette in relazione i cinque segnali fra loro e dice come il verdetto si è mosso nei giorni scorsi. Il giudizio resta calcolato dal codice — questa è la sua lettura, e si chiede dalla dashboard del progetto.",
  },
  "bottleneck-detection": {
    name: "Collo di bottiglia",
    produces:
      "quale fase del flusso trattiene più a lungo il lavoro. È già calcolato e visibile nella pagina «Flusso di lavoro»: come capacità dell'agente mancherebbe solo la narrazione.",
  },
  "project-qa": {
    name: "Domande sul progetto",
    produces: "risposte a domande libere, con la citazione delle fonti usate.",
  },
};
