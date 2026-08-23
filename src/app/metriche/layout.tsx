import type { ReactNode } from "react";

import { SignOutButton } from "@/app/(auth)/sign-out-button";
import { AppHeader } from "@/components/navigation/app-header";

/**
 * Frame for the metrics catalogue.
 *
 * The same header as the project pages, for the same reason: a page without a
 * way out of it is a dead end, and this one is reached *from* a number on the
 * dashboard — so getting back to that number has to be one click, not a
 * remembered address.
 */
export default function MetricsLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen">
      <AppHeader signOut={<SignOutButton />} />
      {children}
    </div>
  );
}
