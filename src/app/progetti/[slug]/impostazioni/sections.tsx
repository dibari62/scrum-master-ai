"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Le sezioni delle impostazioni, una alla volta.
 *
 * **Perché non un unico modulo lungo.** Con l'anagrafica, il connettore e il
 * modello sulla stessa pagina si arriva a una ventina di campi, e il Product
 * Owner ha già segnalato lo stesso difetto sulla dashboard: si scorre in basso
 * per scoprire che cosa esiste. Un elenco che si scopre scorrendo è un elenco
 * che nessuno legge fino in fondo.
 *
 * Tre schede rispondono a tre domande diverse — «come si chiama», «da dove
 * arrivano i dati», «chi scrive i testi» — e chi ne ha una sola in testa non
 * attraversa le altre due.
 *
 * Lo stato vive nel browser e non nell'indirizzo, di proposito: la scheda scelta
 * non è un luogo a cui si torna con un collegamento, e metterla nell'indirizzo
 * riempirebbe la cronologia del browser di voci indistinguibili.
 */

export type SettingsSection = {
  readonly id: string;
  readonly label: string;
  /** Una parola sullo stato, quando c'è qualcosa da dire prima di entrare. */
  readonly hint?: string | undefined;
  readonly content: ReactNode;
};

export function SettingsSections({
  sections,
  initial,
}: {
  readonly sections: readonly SettingsSection[];
  /**
   * Quale scheda aprire.
   *
   * Serve solo dopo un salvataggio: il rimontaggio riporterebbe altrimenti alla
   * prima, e chi ha appena salvato Jira si ritroverebbe sull'anagrafica senza
   * aver chiesto di andarci.
   */
  readonly initial?: string | undefined;
}) {
  const known = sections.some((section) => section.id === initial);
  const [active, setActive] = useState(
    known && initial ? initial : (sections[0]?.id ?? ""),
  );

  return (
    <div className="grid gap-6">
      <div
        role="tablist"
        aria-label="Sezioni delle impostazioni"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {sections.map((section) => {
          const selected = section.id === active;

          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`sezione-${section.id}`}
              onClick={() => setActive(section.id)}
              className={cn(
                "flex shrink-0 flex-col items-start gap-0.5 border-b-2 px-4 py-2 text-left text-sm transition-colors",
                selected
                  ? "border-foreground text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <span>{section.label}</span>
              {/*
               * Lo stato sulla linguetta, non solo dentro.
               *
               * È ciò che permette di sapere che cosa manca **senza** aprire
               * ogni scheda — cioè la ragione per cui le schede non ricreano il
               * problema che risolvono.
               */}
              {section.hint ? (
                <span className="text-muted-foreground text-xs font-normal">
                  {section.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {sections.map((section) => (
        <div
          key={section.id}
          id={`sezione-${section.id}`}
          role="tabpanel"
          hidden={section.id !== active}
        >
          {section.id === active ? section.content : null}
        </div>
      ))}
    </div>
  );
}
