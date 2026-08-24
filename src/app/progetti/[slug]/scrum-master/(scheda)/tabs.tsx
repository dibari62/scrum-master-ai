"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * The menu that splits the card into four screens.
 *
 * **Why a menu and not more headings.** The card answered four unrelated
 * questions on one page — what it can do, what it produced, how it is
 * configured, what it executed — and separating them with headings still left
 * the reader to work out which paragraph belonged to which question. A menu
 * makes that structure visible before anything is read, and lets three quarters
 * of it stay out of the way.
 *
 * A client component only because it needs to know which screen is showing.
 * `useSelectedLayoutSegment` returns `null` on the index route, which is
 * exactly how the first entry recognises itself.
 *
 * Real links, not buttons swapping content: each screen has its own address, so
 * it can be reopened, shared, and returned to with the browser's own back
 * button.
 */

export type SchedaTab = {
  /** The path segment, or `null` for the screen at the root of the card. */
  readonly segment: string | null;
  readonly label: string;
  /** Shown beside the label when there is something worth counting. */
  readonly badge?: number | undefined;
};

export function SchedaTabs({
  base,
  tabs,
}: {
  readonly base: string;
  readonly tabs: readonly SchedaTab[];
}) {
  const current = useSelectedLayoutSegment();

  return (
    <nav aria-label="Sezioni dello Scrum Master AI">
      {/*
       * Scorre in orizzontale su telefono invece di andare a capo.
       *
       * Quattro voci mandate a capo formano due righe che si leggono come due
       * gruppi distinti; una fila che scorre resta una fila sola.
       */}
      <ul className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => {
          const active = current === tab.segment;
          const href = tab.segment === null ? base : `${base}/${tab.segment}`;

          return (
            <li key={tab.label} className="shrink-0">
              <Link
                href={href}
                /*
                 * `aria-current` dice a un lettore di schermo quale voce è
                 * quella aperta. Il colore da solo non glielo direbbe, ed è la
                 * stessa ragione per cui il semaforo della dashboard scrive il
                 * giudizio a parole.
                 */
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                {tab.label}

                {tab.badge === undefined || tab.badge === 0 ? null : (
                  <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-xs tabular-nums">
                    {tab.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
