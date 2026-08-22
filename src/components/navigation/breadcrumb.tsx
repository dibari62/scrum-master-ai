import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The trail back to where you came from.
 *
 * Every page under `/progetti` grew its own copy of this, written slightly
 * differently each time: three separators, three sets of classes, three places
 * to forget a link. More seriously, those copies were the *only* way to leave a
 * page — so a missing one was a dead end, which is exactly the defect that
 * shipped once already, when `/organizzazione` announced that projects would
 * arrive later and offered no way to reach the ones that existed.
 *
 * Presentational: it receives a ready-made trail and decides nothing (§4).
 */

export type Crumb = {
  readonly label: string;
  /** Absent for the current page: the place you already are is not a link. */
  readonly href?: string | undefined;
};

type BreadcrumbProps = {
  readonly trail: readonly Crumb[];
  readonly className?: string | undefined;
};

export function Breadcrumb({ trail, className }: BreadcrumbProps) {
  if (trail.length === 0) return null;

  return (
    <nav aria-label="Percorso" className={cn("text-muted-foreground text-sm", className)}>
      {/*
       * Una lista ordinata: l'ordine *è* l'informazione, e un lettore di
       * schermo annuncia quante voci restano prima della pagina corrente.
       *
       * `flex-wrap` perché su schermo stretto un percorso di tre voci non sta
       * su una riga, e mandarlo a capo è meglio che troncarlo.
       */}
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {trail.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">·</span> : null}

            {crumb.href ? (
              <Link
                href={crumb.href}
                className="hover:text-foreground underline underline-offset-4"
              >
                {crumb.label}
              </Link>
            ) : (
              // `aria-current` dice quale voce è la pagina attuale senza
              // affidarsi al fatto che sia l'ultima.
              <span aria-current="page">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
