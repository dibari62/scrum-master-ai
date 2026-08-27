"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DAY_LABELS, ORDERED_DAYS, type DayOfWeek, type WorkingCalendar } from "@/domain";

import { saveCalendarAction, type SettingsFormState } from "./actions";

/**
 * Quali giorni la squadra lavora, e quali sono festivi.
 *
 * **Perché mancava e perché conta.** Il modello esisteva ed era testato, e
 * nessuno gliene passava mai uno: ogni metrica usava lunedì-venerdì senza
 * festività. Per una squadra italiana significa disegnare Ferragosto, Pasquetta,
 * il 25 aprile e il 2 giugno come giornate di lavoro fermo — esattamente
 * l'allarme fabbricato che il libro descrive:
 *
 * > «We used to include weekends but this would make the burn down slightly
 * > confusing, since it would flatten out over weekends, **which would look like
 * > a warning sign**» (pag. 62)
 *
 * Un grafico che fabbrica allarmi insegna a ignorarlo.
 */

const INITIAL: SettingsFormState = { status: "idle" };

const TEXTAREA_CLASS =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 " +
  "min-h-32 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none " +
  "transition-[color,box-shadow] focus-visible:ring-[3px]";

export function CalendarForm({
  slug,
  calendar,
}: {
  readonly slug: string;
  readonly calendar: WorkingCalendar;
}) {
  const [state, action, pending] = useActionState(saveCalendarAction, INITIAL);
  const [days, setDays] = useState<readonly DayOfWeek[]>(calendar.workingDays);

  const toggle = (day: DayOfWeek) =>
    setDays((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day],
    );

  const error = (name: string) =>
    state.status === "error" ? state.fields[name] : undefined;

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="slug" value={slug} />

      {state.status === "error" ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label>Giorni lavorativi</Label>
        <div className="flex flex-wrap gap-2">
          {ORDERED_DAYS.map((day) => {
            const on = days.includes(day);

            return (
              <label
                key={day}
                className={
                  "cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (on
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <input
                  type="checkbox"
                  name="workingDays"
                  value={day}
                  checked={on}
                  onChange={() => toggle(day)}
                  className="sr-only"
                />
                {DAY_LABELS[day]}
              </label>
            );
          })}
        </div>
        <p className="text-muted-foreground text-sm">
          Il burndown salta i giorni non lavorativi invece di disegnarli piatti. Il libro
          spiega perché: un grafico che si appiattisce nel fine settimana{" "}
          <em>sembra un segnale d&apos;allarme</em>, e un grafico che fabbrica allarmi
          insegna a ignorarlo.
        </p>
        {error("workingDays") ? (
          <p className="text-destructive text-sm">{error("workingDays")}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="holidays">Giorni festivi e chiusure</Label>
        <textarea
          id="holidays"
          name="holidays"
          rows={8}
          className={TEXTAREA_CLASS}
          placeholder={"2026-01-06\n2026-04-06\n2026-04-25"}
          defaultValue={calendar.holidays.join("\n")}
          aria-invalid={error("holidays") ? true : undefined}
        />
        <p className="text-muted-foreground text-sm">
          Una data per riga, nella forma <code className="font-mono">AAAA-MM-GG</code>. Vanno
          qui le feste che non cadono ogni settimana: festività nazionali, il patrono, la
          chiusura di agosto.
        </p>
        <p className="text-muted-foreground text-sm">
          {/*
           * Perché non le mettiamo noi.
           *
           * Le festività dipendono dal paese, dalla regione e persino dal
           * comune — il patrono cambia da città a città — e sceglierle al posto
           * di qualcuno produrrebbe una capacità sbagliata con l'aria di essere
           * stata configurata. Meglio un elenco vuoto che si vede, che uno
           * pieno di date sbagliate.
           */}
          Non le precompiliamo: dipendono dal paese, dalla regione e dal comune — il patrono
          cambia da città a città. Un elenco vuoto è più onesto di uno pieno di date che non
          sono le tue.
        </p>
        {error("holidays") ? (
          <p className="text-destructive text-sm">{error("holidays")}</p>
        ) : null}
      </div>

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Le festività nazionali italiane del 2026, da copiare
        </summary>
        <pre className="text-muted-foreground mt-2 font-mono text-xs whitespace-pre-wrap">
{`2026-01-01
2026-01-06
2026-04-06
2026-04-25
2026-05-01
2026-06-02
2026-08-15
2026-11-01
2026-12-08
2026-12-25
2026-12-26`}
        </pre>
        <p className="text-muted-foreground mt-2">
          Solo quelle nazionali, e solo per il 2026: manca il patrono della tua città, e
          l&apos;anno prossimo Pasquetta cade in un altro giorno.
        </p>
      </details>

      <div className="border-t pt-6">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvataggio…" : "Salva il calendario"}
        </Button>
      </div>
    </form>
  );
}
