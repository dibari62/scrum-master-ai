import { LoadingPage } from "@/components/feedback/page-states";

/** Shown while the impediment register is being read. */
export default function ImpedimentsLoading() {
  return (
    <LoadingPage
      title="Impedimenti"
      description="Lettura del registro degli impedimenti in corso…"
      rows={4}
    />
  );
}
