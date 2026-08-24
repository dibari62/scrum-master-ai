import { LoadingPage } from "@/components/feedback/page-states";

/**
 * Shown while the sprints are being read.
 *
 * See the note in the sibling `persone/loading.tsx`: the free-tier database
 * sleeps, and the first request after a quiet hour pays for waking it.
 */
export default function Loading() {
  return (
    <LoadingPage
      title="Sprint"
      description="Caricamento degli sprint del progetto…"
      rows={4}
    />
  );
}
