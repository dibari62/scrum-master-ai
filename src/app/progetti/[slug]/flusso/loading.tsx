import { LoadingPage } from "@/components/feedback/page-states";

/**
 * Shown while the board is being read.
 *
 * Visible mostly when the Neon instance is waking up from scale-to-zero, which
 * is exactly when a blank frame would look like a broken page.
 */
export default function FlowLoading() {
  return (
    <LoadingPage
      title="Flusso di lavoro"
      description="Lettura della bacheca e conteggio degli elementi in corso…"
      rows={5}
    />
  );
}
