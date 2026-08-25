import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A single metric, with its value or an honest statement of its absence.
 *
 * Purely presentational: it receives strings already decided by the page and
 * formats nothing itself (§4). Not ceremony — `src/components` may not import
 * `src/metrics`, and the architectural check enforces it. Keeping the boundary
 * means this component works for a metric that does not exist yet, and that
 * changing how a number is computed never touches how it looks.
 *
 * The absent case is why this component exists at all. A dashboard printing `0`
 * where a metric could not be computed is worse than one showing nothing: the
 * reader cannot tell a measured zero from a missing measurement, and will act
 * on the first reading.
 */

type MetricCardProps = {
  readonly label: string;
  /** Already formatted. `null` when the metric has no value. */
  readonly value: string | null;
  /** Sample size, or the reason there is no value. Always shown. */
  readonly detail: string;
  /** One line explaining what the number means. */
  readonly hint?: string | undefined;
  readonly emphasis?: "normal" | "warning";
  /**
   * Where the number can be opened.
   *
   * Optional, and the card looks the same without it, but a figure that leads
   * somewhere is a figure that can be checked instead of believed. The card
   * receives the address ready-made: deciding *which* items are behind a metric
   * is the page's business, not this component's.
   */
  readonly href?: string | undefined;
};

/** Shown instead of a number: never `0`, never an empty cell. */
const NO_VALUE = "—";

export function MetricCard({
  label,
  value,
  detail,
  hint,
  emphasis = "normal",
  href,
}: MetricCardProps) {
  const body = (
    <>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </p>

      <p
        className={cn(
          "text-3xl font-semibold tracking-tight tabular-nums",
          value === null && "text-muted-foreground text-2xl",
          value !== null && emphasis === "warning" && "text-destructive",
        )}
      >
        {value ?? NO_VALUE}
      </p>

      <p className="text-muted-foreground text-xs">{detail}</p>

      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </>
  );

  // `ring` e non `border`, come le schede: sei riquadri con il bordo pieno
  // formano una griglia che compete con i numeri che dovrebbero risaltare.
  const shell = "bg-card ring-border/70 grid gap-1 rounded-xl p-4 ring-1";

  if (!href) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <Link
      href={href}
      className={cn(
        shell,
        "hover:ring-foreground/25 hover:bg-accent/50 transition-[background-color,box-shadow]",
      )}
    >
      {body}
    </Link>
  );
}
