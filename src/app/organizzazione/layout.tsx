import type { ReactNode } from "react";

/**
 * Frame for the signed-in area. Kept separate from the `(auth)` layout because
 * the two differ in what belongs on screen, not only in spacing.
 */
export default function OrganizationLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      {children}
    </main>
  );
}
