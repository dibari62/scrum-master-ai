import type { ReactNode } from "react";

import { Breadcrumb } from "@/components/navigation/breadcrumb";

import { AUTONOMY, PERSONA, STATUS } from "../labels";
import { loadReports, loadRuns, loadScheda } from "../scheda";
import { SchedaTabs } from "./tabs";

/**
 * The shared frame of the Scrum Master AI card.
 *
 * Holds the two things that must never move as the reader changes screen: what
 * this thing is, and the menu. Everything else belongs to one screen and only
 * one.
 *
 * The creation wizard deliberately sits **outside** this route group. It is
 * what runs when no agent exists, so inheriting a header describing an agent's
 * state would be describing something that is not there — and the loader would
 * redirect to the wizard from inside the wizard's own layout.
 */

type LayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly slug: string }>;
};

export default async function SchedaLayout({ children, params }: LayoutProps) {
  const { slug } = await params;

  const { project, agent } = await loadScheda(slug);
  const [{ latestPerSprint }, runs] = await Promise.all([
    loadReports(slug),
    loadRuns(slug),
  ]);

  const base = `/progetti/${slug}/scrum-master`;

  return (
    <main className="app-shell grid gap-6 py-10">
      <header className="grid gap-3">
        <Breadcrumb
          trail={[
            { label: "Progetti", href: "/progetti" },
            { label: project.name, href: `/progetti/${slug}` },
            { label: "Scrum Master AI" },
          ]}
        />

        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>

          {/*
           * Che cosa sia, prima di qualunque impostazione.
           *
           * Chi arriva qui la prima volta non sa se stia guardando un modello,
           * un servizio o un elenco di preferenze — e senza questa frase ogni
           * riga successiva è il dettaglio di qualcosa di ignoto. Sta nel
           * contenitore comune perché la domanda resta la stessa su tutte e
           * quattro le schermate.
           */}
          <p className="text-sm">
            È lo Scrum Master AI di questo progetto:{" "}
            <strong>legge i numeri già calcolati dal codice e ne scrive una lettura</strong>.
            Non è un modello addestrato — è una configurazione, la memoria di questo
            progetto e un elenco di capacità che si accendono una alla volta.
          </p>
        </div>

        {/*
         * Lo stato in una riga sola, perché è un'informazione di contorno.
         *
         * Le spiegazioni per esteso stanno in «Com'è configurato»: qui servono i
         * due fatti che cambiano il senso di tutto il resto — se è attivo e fin
         * dove può spingersi.
         */}
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{STATUS[agent.status].label}</span>{" "}
          · {AUTONOMY[agent.autonomyLevel].label} —{" "}
          {AUTONOMY[agent.autonomyLevel].explanation} · {PERSONA[agent.persona].label}
        </p>
      </header>

      <SchedaTabs
        base={base}
        tabs={[
          { segment: null, label: "Cosa può fare" },
          { segment: "resoconti", label: "Resoconti", badge: latestPerSprint.length },
          { segment: "configurazione", label: "Configurazione" },
          { segment: "diario", label: "Diario tecnico", badge: runs.length },
        ]}
      />

      {children}
    </main>
  );
}
