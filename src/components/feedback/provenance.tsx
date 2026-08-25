import type { ReactNode } from "react";

/**
 * The frame that says who wrote the text inside it.
 *
 * **Why the distinction is drawn with a frame and not a sentence.** A dashboard
 * mixes two kinds of statement that look identical once they are on screen:
 * figures the code measured, which are either right or a bug, and prose a
 * language model wrote, which can be fluent and wrong at the same time. A reader
 * who cannot tell them apart has to trust the whole page equally — and the
 * honest amount of trust is not the same for the two halves.
 *
 * So generated prose is boxed, dashed, and labelled before it is read, rather
 * than followed by a disclaimer nobody reaches. The label is a word, not a
 * colour: the frame alone would say nothing to anyone listening to the page,
 * which is why it also names itself through `aria-label`.
 *
 * Presentational, like everything in `src/components`: it receives its words and
 * decides nothing (§4). It never interprets its children as markup — text that a
 * model produced is rendered as text, always.
 */

export type Provenance =
  /** Written by a language model: interpretation, fallible. */
  | "generated"
  /** Assembled by the code from measured figures: no model involved. */
  | "computed";

const FRAME: Readonly<Record<Provenance, string>> = {
  generated: "border-primary/50 border-dashed bg-primary/5",
  computed: "border-border bg-muted/40",
};

type ProvenanceBlockProps = {
  readonly provenance: Provenance;
  /** Two or three words naming the origin. Becomes the block's own name. */
  readonly label: string;
  /** What that origin implies for the reader, in one sentence. */
  readonly note: string;
  readonly children: ReactNode;
};

export function ProvenanceBlock({
  provenance,
  label,
  note,
  children,
}: ProvenanceBlockProps) {
  return (
    <section
      aria-label={label}
      /*
       * `min-w-0`: dentro una griglia un elemento parte con `min-width: auto`,
       * cioè «non restringermi sotto il mio contenuto». Una parola lunga o una
       * riga di cifre allargherebbe il riquadro oltre lo schermo di un telefono.
       */
      className={`grid min-w-0 gap-3 rounded-md border p-3 ${FRAME[provenance]}`}
    >
      <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="bg-background text-foreground rounded-full border px-2 py-0.5 font-medium">
          {label}
        </span>
        <span className="min-w-0">{note}</span>
      </p>

      {children}
    </section>
  );
}
