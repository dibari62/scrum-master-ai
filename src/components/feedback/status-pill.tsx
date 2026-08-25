import type { ReactNode } from "react";

/**
 * Whether something is switched on, readable without reading the paragraph.
 *
 * **Why a pill and not a sentence.** A screen listing capabilities answers one
 * question before any other: which of these work right now. Buried in prose that
 * answer takes a paragraph per card to find; on a pill beside the name it takes
 * a glance. The Product Owner's report — «I could not find sprint health» — was
 * exactly this: the capability was there, described correctly, and its state was
 * only discoverable by reading to the end of the card.
 *
 * The state is a **word**. The dot is decoration and says so, because colour
 * reaches neither someone who cannot separate red from green nor anyone
 * listening to the page.
 *
 * Presentational (§4): it receives its words and decides nothing.
 */

export type PillTone =
  /** Switched on: usable now. */
  | "on"
  /** Switched off, and there is a control to switch it on. */
  | "off"
  /** Not built in this release: there is nothing to switch. */
  | "unavailable";

const TONE: Readonly<Record<PillTone, string>> = {
  on: "border-emerald-600/50 text-emerald-700 dark:text-emerald-400",
  off: "border-border text-muted-foreground",
  unavailable: "border-border border-dashed text-muted-foreground",
};

const DOT: Readonly<Record<PillTone, string>> = {
  on: "bg-emerald-600",
  off: "bg-muted-foreground/40",
  unavailable: "bg-transparent border border-muted-foreground/40",
};

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: PillTone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}
