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
 */
export function AppHeader({ signOut }: { readonly signOut?: ReactNode }) {
  return (
    <header className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
      {/*
       * `sticky` perché le pagine di progetto sono lunghe: dopo tre schermate
       * di scorrimento l'uscita non deve essere a un viaggio di ritorno di
       * distanza.
       */}
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-6">
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
