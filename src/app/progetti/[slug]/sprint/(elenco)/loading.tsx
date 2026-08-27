import { LoadingPage } from "@/components/feedback/page-states";

/**
 * Shown while the sprints are being read.
 *
 * See the note in the sibling `persone/loading.tsx`: the free-tier database
 * sleeps, and the first request after a quiet hour pays for waking it.
 *
 * **Inside a route group, and that is the point.** A `loading.tsx` applies to
 * everything nested under it, so at `sprint/` it also covered `sprint/[id]` —
 * and a route with a loading boundary **streams**, which means its headers go
 * out before the code runs. A sprint that does not exist then answered `200`
 * with a not-found page: right for a reader, a lie for anything reading the
 * status. The group scopes this to the list, where it belongs.
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
