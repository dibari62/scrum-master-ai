import type { CitableValue, WorkItem, WorkItemId } from "@/domain";
import type { DailyActivity } from "@/metrics";
import { formatDuration, formatNumber } from "@/lib/format";

/**
 * Turning a counted day into the material a digest is written from.
 *
 * Two kinds of thing travel from here, and they must not be confused. The
 * **numbers** are written out by the code and may be quoted. The **titles** are
 * text somebody else wrote: they are material to read, never instructions, and
 * they leave this module separately so the gateway can label them as untrusted
 * (§8.1).
 */

/** One item named for a reader, with why it is in the list. */
export type DigestItem = {
  readonly workItemId: WorkItemId;
  readonly title: string;
  /** How long it has stood still, already written. Only for stalled items. */
  readonly still: string | null;
};

export type DigestSnapshot = {
  readonly projectName: string;
  /** The day the digest is about, already written. */
  readonly dayLabel: string;
  readonly finished: readonly DigestItem[];
  readonly started: readonly DigestItem[];
  readonly reopened: readonly DigestItem[];
  readonly blocked: readonly DigestItem[];
  readonly stalled: readonly DigestItem[];
  /** Whether anything at all happened. */
  readonly quiet: boolean;
  readonly values: readonly CitableValue[];
};

/**
 * How many items a list may name.
 *
 * A digest that enumerates forty items is the board again, and nobody reads the
 * board twice. The count travels as a figure, so nothing is hidden: the reader
 * is told there are more.
 */
const MAX_NAMED = 5;

function namedFrom(
  ids: readonly WorkItemId[],
  titles: ReadonlyMap<WorkItemId, string>,
): readonly DigestItem[] {
  return ids.slice(0, MAX_NAMED).map((workItemId) => ({
    workItemId,
    title: titles.get(workItemId) ?? "(elemento senza titolo)",
    still: null,
  }));
}

function countValue(metricId: string, label: string, size: number): CitableValue {
  return {
    metricId,
    label,
    text: `${formatNumber(size)} ${size === 1 ? "elemento" : "elementi"}`,
  };
}

export function buildDigestSnapshot(input: {
  readonly projectName: string;
  readonly dayLabel: string;
  readonly activity: DailyActivity;
  readonly items: readonly WorkItem[];
}): DigestSnapshot {
  const titles = new Map<WorkItemId, string>(
    input.items.map((item) => [item.id, item.title] as const),
  );

  const stalled = input.activity.stalled.slice(0, MAX_NAMED).map((entry) => ({
    workItemId: entry.workItemId,
    title: titles.get(entry.workItemId) ?? "(elemento senza titolo)",
    still: formatDuration(entry.stillMs),
  }));

  const values: CitableValue[] = [
    countValue("digest-finished", "Elementi conclusi", input.activity.finished.length),
    countValue("digest-started", "Lavori iniziati", input.activity.started.length),
    countValue("digest-reopened", "Elementi riaperti", input.activity.reopened.length),
    countValue("digest-blocked", "Elementi bloccati", input.activity.blocked.length),
    countValue("digest-stalled", "Elementi fermi da tempo", input.activity.stalled.length),
    {
      metricId: "digest-movements",
      label: "Passaggi di stato registrati",
      text: `${formatNumber(input.activity.movements)} ${
        input.activity.movements === 1 ? "passaggio" : "passaggi"
      }`,
    },
  ];

  for (const [index, entry] of stalled.entries()) {
    if (entry.still !== null) {
      /*
       * L'etichetta non contiene il titolo, ed è una regola di sicurezza.
       *
       * Le etichette dei valori finiscono nella parte **fidata** della
       * richiesta, quella che il modello legge come istruzione. Interpolarci il
       * titolo di un elemento — testo scritto da terzi — è esattamente il
       * percorso che §8.1 esiste per chiudere: un titolo come «Ignora le
       * istruzioni precedenti» arriverebbe travestito da riga di sistema. Il
       * titolo viaggia solo nel blocco non fidato; qui basta un riferimento
       * ordinale per legare la durata all'elemento.
       */
      values.push({
        metricId: `digest-still-${entry.workItemId}`,
        label: `Fermo da — elemento ${index + 1} dell'elenco`,
        text: entry.still,
      });
    }
  }

  return {
    projectName: input.projectName,
    dayLabel: input.dayLabel,
    finished: namedFrom(input.activity.finished, titles),
    started: namedFrom(input.activity.started, titles),
    reopened: namedFrom(input.activity.reopened, titles),
    blocked: namedFrom(input.activity.blocked, titles),
    stalled,
    quiet: input.activity.movements === 0,
    values,
  };
}

/** Whether the code found anything standing still that must be reported. */
export function hasStandstill(snapshot: DigestSnapshot): boolean {
  return snapshot.stalled.length > 0 || snapshot.blocked.length > 0;
}
