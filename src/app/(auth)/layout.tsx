import type { ReactNode } from "react";

/**
 * Frame shared by the registration and sign-in pages: a single centred card on
 * an otherwise empty page, with nothing to click that leads away from the task.
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      {children}
    </main>
  );
}
