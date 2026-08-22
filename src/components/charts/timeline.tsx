import { formatDuration, formatShortDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The history of one work item, drawn as a vertical timeline.
 *
 * **This is the most instructive screen in the application.** Every flow metric
 * is a question about how long something stayed somewhere, so a reader who
 * follows these spans can recompute the numbers by hand. That is the difference
 * between a dashboard that must be believed and one that can be checked.
 *
 * Presentational only (§4): it receives strings and durations already decided
 * by the page, and knows nothing about metrics.
 */

export type TimelineEntry = {
  /** The canonical state, in Italian, decided by the caller. */
  readonly label: string;
  readonly enteredAt: Date;
  /** `null` while the item is still here. */
  readonly leftAt: Date | null;
  readonly duration: number;
  /** How this span is read by the metrics: work, queue, or neither. */
  readonly nature: "work" | "queue" | "blocked" | "idle" | "done";
  /** Who moved it, when the source says so. */
  readonly actor?: string | undefined;
};

type TimelineProps = {
  readonly entries: readonly TimelineEntry[];
};

/**
 * The colour says what the span *means*, not merely which state it was.
 *
 * Deliberately three meanings and not six states: the question a reader has is
 * "was this time work or waiting", and mapping states straight to colours would
 * make them look through a legend to answer it.
 */
const NATURE_STYLE: Readonly<Record<TimelineEntry["nature"], string>> = {
  work: "bg-primary",
  queue: "bg-amber-500",
  blocked: "bg-destructive",
  idle: "bg-muted-foreground/40",
  done: "bg-emerald-600",
};

const NATURE_LABEL: Readonly<Record<TimelineEntry["nature"], string>> = {
  work: "lavorazione",
  queue: "attesa",
  blocked: "bloccato",
  idle: "fermo in backlog",
  done: "concluso",
};

export function Timeline({ entries }: TimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nessuna transizione registrata per questo elemento.
      </p>
    );
  }

  return (
    <ol className="grid gap-0">
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;

        /*
         * A terminal state is a point in time, not a span.
         *
         * `stateIntervals` runs the final span to the reference instant, which
         * is right for the metrics — it is what makes "how long has this been
         * stuck" answerable. Printed as-is it read "Concluso · 107 giorni",
         * which suggests something has been going on for months when the item
         * finished in May and nothing has happened since.
         */
        const terminal = entry.nature === "done";

        return (
          <li key={`${entry.label}-${entry.enteredAt.toISOString()}`} className="flex gap-3">
            {/* The rail: a dot for the moment, a line for the span that follows. */}
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  "mt-1.5 size-2.5 shrink-0 rounded-full",
                  NATURE_STYLE[entry.nature],
                )}
              />
              {!last ? <span className="bg-border w-px flex-1" /> : null}
            </div>

            <div className={cn("grid gap-0.5", last ? "pb-1" : "pb-6")}>
              <p className="text-sm font-medium">{entry.label}</p>

              <p className="text-muted-foreground text-xs">
                {formatShortDateTime(entry.enteredAt)}
                {terminal ? "" : entry.leftAt ? ` → ${formatShortDateTime(entry.leftAt)}` : " → adesso"}
              </p>

              <p className="text-xs">
                {terminal ? null : (
                  <>
                    <span className="tabular-nums">{formatDuration(entry.duration)}</span>
                    <span className="text-muted-foreground"> · </span>
                  </>
                )}
                <span className="text-muted-foreground">{NATURE_LABEL[entry.nature]}</span>
                {entry.actor ? (
                  <span className="text-muted-foreground"> · {entry.actor}</span>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
