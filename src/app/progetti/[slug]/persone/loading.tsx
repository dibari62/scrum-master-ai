import { LoadingPage } from "@/components/feedback/page-states";

/**
 * Shown while the roster is being read.
 *
 * A file called `loading.tsx` is a Next.js convention: the framework shows it
 * automatically while the page's own data is still arriving, and replaces it
 * when the page is ready. It matters here more than it looks — the database
 * scales to zero on the free tier, so the first request after a quiet hour
 * waits for it to wake up.
 */
export default function Loading() {
  return (
    <LoadingPage
      title="Persone"
      description="Caricamento dell'anagrafica del progetto…"
      rows={5}
    />
  );
}
