import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A list of records, shown as columns instead of a stack of boxes.
 *
 * **Why this exists.** Every list in this product was a column of bordered
 * cards, each with its facts written as a sentence separated by middots:
 * «In lavorazione · Sprint 3 · 5 punti · 12 transizioni». The Product Owner put
 * it exactly right — they read as *many separate entities* rather than one set
 * of comparable rows.
 *
 * Two things were wrong, and they are different:
 *
 * 1. **The box.** A border around each row draws attention to the boundary
 *    between records, which is the least interesting thing about a list. Rows
 *    separated by a hairline read as one table; rows in boxes read as a pile.
 * 2. **The sentence.** With values written inline, nothing lines up: the state
 *    of row four sits under the sprint name of row three. Comparing two records
 *    means reading both, where a column lets the eye do it. That is the entire
 *    reason tables were invented.
 *
 * Purely presentational (§4): it receives cells already rendered by the page
 * and decides nothing about them.
 */

export type Column<Row> = {
  readonly key: string;
  readonly header: string;

  /**
   * Numbers go right, words go left.
   *
   * Not decoration: right-aligned figures share a decimal position, so «8» and
   * «13» line up by magnitude and the eye can scan a column for the biggest
   * without reading any of it.
   */
  readonly align?: "start" | "end";

  /** Tailwind width hints, e.g. `min-w-[16rem]`. */
  readonly className?: string;

  readonly cell: (row: Row) => ReactNode;
};

type DataTableProps<Row> = {
  readonly caption: string;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly getKey: (row: Row) => string;

  /**
   * Where a row leads, when it leads anywhere.
   *
   * The link wraps the **first cell** rather than the whole row: an anchor
   * cannot contain a `<td>`, and a row-wide click target built with JavaScript
   * would stop working with JavaScript off — which the rest of this product
   * does not require.
   */
  readonly getHref?: (row: Row) => string;

  /**
   * The smallest width at which every column still fits.
   *
   * Below it the table scrolls sideways inside its own container, which is why
   * this never widens the page. Shrinking columns instead would eventually
   * wrap a date onto three lines, and a table whose rows are different heights
   * has stopped being a table.
   */
  readonly minWidth?: string;

  /**
   * A data attribute to stamp on every row, e.g. `data-run`.
   *
   * For end-to-end tests that need to count rows without a selector that also
   * catches breadcrumbs and filter chips — a real problem this suite already
   * hit with `main ul > li`. Optional, because most tables have nothing else on
   * the page to be confused with.
   */
  readonly rowAttribute?: string;
};

export function DataTable<Row>({
  caption,
  columns,
  rows,
  getKey,
  getHref,
  minWidth = "min-w-[44rem]",
  rowAttribute,
}: DataTableProps<Row>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", minWidth)}>
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr className="text-muted-foreground border-b">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "py-2 pr-4 text-xs font-medium tracking-wide uppercase last:pr-0",
                  column.align === "end" ? "text-right" : "text-left",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const href = getHref?.(row);

            return (
              <tr
                key={getKey(row)}
                {...(rowAttribute ? { [rowAttribute]: "" } : {})}
                // `border-b last:border-0`: una riga sola non ha bisogno di una
                // linea sotto, e l'ultima chiuderebbe la tabella due volte.
                className="hover:bg-muted/40 border-b transition-colors last:border-0"
              >
                {columns.map((column, index) => {
                  const content = column.cell(row);

                  return (
                    <td
                      key={column.key}
                      className={cn(
                        "py-2.5 pr-4 align-top last:pr-0",
                        column.align === "end" && "text-right tabular-nums",
                        column.className,
                      )}
                    >
                      {index === 0 && href ? (
                        <Link
                          href={href}
                          className="hover:underline focus-visible:underline underline-offset-4"
                        >
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
