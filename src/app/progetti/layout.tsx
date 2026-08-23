import type { ReactNode } from "react";

import { SignOutButton } from "@/app/(auth)/sign-out-button";
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
      <AppHeader signOut={<SignOutButton />} />
      {children}
    </div>
  );
}
