import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * The sprint-health indicator.
 *
 * **The colour is never the only carrier of the meaning.** Roughly one man in
 * twelve cannot reliably separate red from green, and nobody using a screen
 * reader receives a colour at all. So the verdict is a word first, a sentence
 * second, and a colour third — in that order, and the word is what the tests
 * assert.
 *
 * **A light without a reason is decoration.** The line that makes this useful is
 * not the one that says "critico", it is the one underneath that says which
 * measurement, against which threshold, and by how much. That is why the
 * findings are listed rather than summarised, and why the ones that could not be
 * evaluated are listed too: a signal missing from the list would read as a
 * signal that passed.
 *
 * Presentational, like everything in `src/components`: it receives words and
 * decides nothing (§4).
 */

export type HealthBannerSignal = {
  readonly title: string;
  readonly explanation: string;
  readonly figures: string | null;
  /** Drives the ordering and the accent, never the wording. */
  readonly tone: "respected" | "watch" | "critical" | "not-evaluable";
};

type HealthBannerProps = {
  readonly verdict: HealthBannerSignal["tone"];
  readonly label: string;
  readonly summary: string;
  /** How far through the sprint we are, already formatted. */
  readonly elapsed: string;
  readonly signals: readonly HealthBannerSignal[];
};

const ACCENT: Readonly<Record<HealthBannerSignal["tone"], string>> = {
  respected: "border-l-4 border-l-emerald-600",
  watch: "border-l-4 border-l-amber-500",
  critical: "border-l-4 border-l-destructive",
  "not-evaluable": "border-l-4 border-l-muted-foreground/40",
};

const DOT: Readonly<Record<HealthBannerSignal["tone"], string>> = {
  respected: "bg-emerald-600",
  watch: "bg-amber-500",
  critical: "bg-destructive",
  "not-evaluable": "bg-muted-foreground/40",
};

/**
 * Worst first.
 *
 * The reader's attention is spent at the top of a list, so anything that made
 * the verdict what it is has to be there. Sorting alphabetically, or by the
 * order the engine happens to return, would bury the reason for the colour
 * under four things that are fine.
 */
const ORDER: Readonly<Record<HealthBannerSignal["tone"], number>> = {
  critical: 0,
  watch: 1,
  respected: 2,
  "not-evaluable": 3,
};

export function HealthBanner({
  verdict,
  label,
  summary,
  elapsed,
  signals,
}: HealthBannerProps) {
  const ordered = [...signals].sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);

  return (
    <Card className={ACCENT[verdict]}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/*
           * Il pallino è decorazione e lo dichiara: la parola accanto porta
           * già l'informazione, e un lettore di schermo che annunciasse anche
           * il colore direbbe la stessa cosa due volte.
           */}
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT[verdict]}`} />
            <span className="text-base leading-none font-semibold">{label}</span>
          </span>

          <span className="text-muted-foreground text-xs">{elapsed}</span>
        </div>

        <p className="text-muted-foreground text-sm">{summary}</p>
      </CardHeader>

      <CardContent>
        <ul className="grid gap-3">
          {ordered.map((signal) => (
            <li key={signal.title} className="grid gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${DOT[signal.tone]}`}
                />
                <span className="text-sm font-medium">{signal.title}</span>

                {signal.figures === null ? null : (
                  <span className="text-muted-foreground text-xs">{signal.figures}</span>
                )}
              </div>

              <p className="text-muted-foreground pl-3.5 text-sm">{signal.explanation}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
