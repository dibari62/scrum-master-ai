import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OrganizationId, Project } from "@/domain";

import { loadProjects } from "./data";

/**
 * The list itself, separated from the page around it.
 *
 * It is the only part that reads from the database, so it is the only part that
 * has to wait: keeping it in its own component lets the page render its heading
 * and its «Nuovo progetto» button immediately, and stream this in when the
 * answer arrives. On a free-tier database that wakes from sleep, the difference
 * is a screen with a title and a way forward instead of a blank one.
 *
 * Three states, all of them here: waiting (the fallback in `page.tsx`), empty,
 * and failed.
 */

type ProjectListProps = {
  readonly organizationId: OrganizationId;
  /** Whether this person may create one, which changes what "empty" should say. */
  readonly canCreate: boolean;
};

/** The skeleton shown while the list is being read. */
export function ProjectListFallback() {
  return (
    <div className="grid gap-3">
      {/*
       * `role="status"` fa annunciare l'attesa a chi usa un lettore di schermo,
       * che altrimenti troverebbe una pagina senza contenuto e nessuna
       * spiegazione. I rettangoli sotto sono decorazione e restano muti.
       */}
      <p role="status" className="text-muted-foreground text-sm">
        Caricamento dei progetti…
      </p>
      <div aria-hidden="true" className="grid gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="bg-muted h-24 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/**
 * The empty state, which is the first screen a new company ever sees.
 *
 * It used to say «esegui `npm run seed`». That is a command from a terminal, on
 * a machine that has the repository checked out: for anyone who registered
 * through the browser it was an instruction that could not be followed, in a
 * screen that offered nothing else. The invitation now points at the thing the
 * product actually does, and the seed stays as a note for whoever is developing.
 */
function EmptyState({ canCreate }: { readonly canCreate: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nessun progetto, per ora</CardTitle>
        <CardDescription>
          Un progetto è il contenitore dei suoi sprint, dei suoi elementi di lavoro e delle
          sue metriche. È anche ciò a cui si affianca uno Scrum Master AI: senza un
          progetto non c&apos;è nulla da assistere.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {canCreate ? (
          <div>
            <Button asChild>
              <Link href="/progetti/crea">Crea il primo progetto</Link>
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            La creazione di un progetto è riservata a chi amministra l&apos;azienda: chiedi
            a un amministratore di crearne uno.
          </p>
        )}

        <p className="text-muted-foreground text-xs">
          Per chi sviluppa: <code className="font-mono">npm run seed -- --conferma</code>{" "}
          popola invece un progetto dimostrativo con una storia sintetica di sprint.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Shown when the read fails.
 *
 * Never the raw error: the message of a failed query can carry a connection
 * string or a fragment of somebody else's data (§8.3). What the reader gets is
 * what they can do about it — and the reassurance that nothing was written,
 * because "riprova" is only safe advice if that is true.
 */
function ListError() {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">
          Non è stato possibile caricare i progetti
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          L&apos;elenco non è stato letto. Nessun dato è stato modificato: si può riprovare
          senza conseguenze.
        </p>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/progetti">Riprova</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export async function ProjectList({ organizationId, canCreate }: ProjectListProps) {
  let projects: readonly Project[];

  try {
    projects = await loadProjects(organizationId);
  } catch {
    /*
     * L'errore si gestisce qui invece di risalire a un `error.tsx`.
     *
     * Un `error.tsx` messo su `/progetti` coprirebbe anche le pagine dei
     * singoli progetti, che stanno sotto lo stesso segmento: chi vede fallire
     * una dashboard leggerebbe «non è stato possibile caricare i progetti», che
     * è vero solo per metà. Il confine di errore resta dove sta la lettura.
     *
     * Non è un `catch` silenzioso: Next registra già l'errore lato server, e
     * questa vista mostra un esito, non lo nasconde.
     */
    return <ListError />;
  }

  if (projects.length === 0) return <EmptyState canCreate={canCreate} />;

  return (
    <ul className="grid gap-3">
      {projects.map((project) => (
        <li key={project.id}>
          <Link href={`/progetti/${project.slug}`} className="block">
            <Card className="hover:border-foreground/30 transition-colors">
              <CardHeader>
                <CardTitle className="text-lg">{project.name}</CardTitle>
                <CardDescription>
                  {project.description ?? "Nessuna descrizione."}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground font-mono text-xs break-all">
                {project.slug}
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
