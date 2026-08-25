"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The sections of a project, always in view.
 *
 * **Why this exists.** Everything a project can do was reachable only from a
 * row of seven identical outline buttons on the dashboard, three lines below
 * the title. Two consequences, both observed: from any other page there was no
 * way across without going back to the dashboard first, and on the dashboard
 * itself the row read as decoration rather than navigation — the Product Owner
 * reported having to scroll to find out what the product could do.
 *
 * A tab bar in the layout fixes both at once. It is present on every project
 * page because it lives in the layout, and it says **where you are**, which a
 * row of buttons never did.
 *
 * `"use client"` for one reason only: the active tab depends on the current
 * path, and `usePathname` is a client hook. Nothing else here is interactive —
 * these are ordinary links, and they work with JavaScript disabled.
 *
 * It takes its items as a prop rather than building them: `src/components` may
 * not know the route table of `src/app`, and the boundary check enforces it.
 */

export type ProjectTab = {
  readonly label: string;
  readonly href: string;
  /**
   * True when this tab should also match deeper paths.
   *
   * The overview is the project root, so every other section is "under" it —
   * without this distinction the overview would look active on every page, and
   * a tab bar where two tabs are lit is worse than one where none is.
   */
  readonly exact?: boolean;
};

export function ProjectTabs({ tabs }: { readonly tabs: readonly ProjectTab[] }) {
  const pathname = usePathname();

  return (
    <div
      className="bg-background/80 sticky z-10 border-b backdrop-blur"
      style={{ top: "var(--app-header-height)" }}
    >
      {/*
       * Scorrimento orizzontale su schermi stretti, invece di andare a capo.
       *
       * Otto voci a capo su telefono formano un blocco alto tre righe che
       * spinge il contenuto sotto la piega — cioè ricreano esattamente il
       * problema che questa barra risolve.
       */}
      <nav
        aria-label="Sezioni del progetto"
        className="app-shell no-scrollbar flex items-stretch gap-1 overflow-x-auto"
        style={{ height: "var(--project-tabs-height)" }}
      >
        {tabs.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
                active
                  ? "border-foreground text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
