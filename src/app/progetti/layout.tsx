import type { ReactNode } from "react";

import { signOutAction } from "@/app/(auth)/actions";
import { AppHeader } from "@/components/navigation/app-header";

/**
 * Frame for every page under `/progetti`.
 *
 * The header lives in a layout rather than in each page so that a new page
 * cannot be born without a way out of it. That is not hypothetical: a page did
 * ship as a dead end once, and the fix was a link somebody remembered to add.
 * A layout removes the remembering.
 */
export default function ProjectsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen">
      <AppHeader
        signOut={
          /*
           * Un modulo, non un collegamento: uscire cambia lo stato del server,
           * e un cambiamento di stato non passa da una GET. Un prefetch o un
           * antivirus che visita i collegamenti chiuderebbe la sessione da solo.
           */
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Esci
            </button>
          </form>
        }
      />

      {children}
    </div>
  );
}
