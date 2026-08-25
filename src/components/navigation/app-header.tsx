import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The bar across the top of the signed-in area.
 *
 * It exists because leaving a page was only possible through whatever links
 * that page happened to carry. Signing out could be reached from exactly one
 * screen, and from a project page there was no way back to the company area at
 * all — every route out had to be typed by hand.
 *
 * Deliberately thin. There is one product, one company per session and a
 * handful of pages: a navigation menu here would be furniture for a building
 * with three rooms.
 *
 * The sign-out control arrives as a child rather than being imported. A server
 * action lives in `src/app`, and `src/components` may not reach into it — the
 * boundary check enforces that, and it is right to: a presentational component
 * that knew how to end a session would be deciding something.
 *
 * Its height comes from `--app-header-height` because `scroll-padding-top` in
 * the stylesheet must reserve exactly that much room. When the two were
 * separate numbers, anything the browser scrolled into view landed underneath
 * this bar and the clicks went to the bar instead.
 */
export function AppHeader({ signOut }: { readonly signOut?: ReactNode }) {
  return (
    <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
      {/*
       * `sticky` perché le pagine di progetto sono lunghe: dopo tre schermate
       * di scorrimento l'uscita non deve essere a un viaggio di ritorno di
       * distanza.
       */}
      <div
        className="app-shell flex items-center justify-between gap-4"
        style={{ height: "var(--app-header-height)" }}
      >
        <Link href="/progetti" className="text-sm font-semibold tracking-tight">
          Scrum&nbsp;Master&nbsp;AI
        </Link>

        <nav aria-label="Navigazione principale" className="flex items-center gap-4 text-sm">
          <Link href="/organizzazione" className="text-muted-foreground hover:text-foreground">
            Azienda
          </Link>

          {signOut}
        </nav>
      </div>
    </header>
  );
}
