import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";
import { mayCreateProject } from "@/lib/projects/create";

import { ProjectList, ProjectListFallback } from "./project-list";

export const metadata: Metadata = {
  title: "Progetti · Scrum Master AI",
};

/**
 * Rendered per request: the list depends on who is asking.
 */
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const organizationId = organizationIdSchema.parse(session.organizationId);

  /*
   * Il pulsante compare solo a chi può usarlo, e questo non è il controllo.
   *
   * L'autorizzazione vera sta nella server action, dentro `createProject`: qui
   * si decide soltanto se offrire un comando che funzionerebbe. Un pulsante che
   * porta a un rifiuto insegna a diffidare dei pulsanti.
   */
  const canCreate = mayCreateProject(session.role);

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-6 py-12">
      {/*
       * Intestazione e comando insieme, e il comando resta al suo posto anche
       * quando l'elenco è vuoto: è proprio lì che serve, perché quella è la
       * schermata di chi non ha ancora nulla.
       *
       * `flex-wrap` con il pulsante a larghezza piena sotto i 640 pixel: su
       * telefono affiancarlo al titolo lo stringerebbe fino a spezzarne il
       * testo.
       */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Progetti</h1>
          <p className="text-muted-foreground text-sm">
            Ogni progetto ha i propri sprint, il proprio flusso e le proprie metriche.
          </p>
        </div>

        {canCreate ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/progetti/crea">Nuovo progetto</Link>
          </Button>
        ) : null}
      </header>

      {/*
       * `Suspense` delimita l'attesa alla sola parte che legge dal database.
       *
       * È il meccanismo con cui React mostra un segnaposto mentre un pezzo di
       * pagina è ancora in arrivo: l'intestazione e il pulsante qui sopra sono
       * già visibili e già utilizzabili mentre l'elenco viaggia. Il database sul
       * piano gratuito si addormenta, e la prima richiesta dopo un'ora di quiete
       * paga il risveglio.
       */}
      <Suspense fallback={<ProjectListFallback />}>
        <ProjectList organizationId={organizationId} canCreate={canCreate} />
      </Suspense>

      <p className="text-muted-foreground text-sm">
        <Link href="/organizzazione" className="underline underline-offset-4">
          Torna all&apos;area azienda
        </Link>
      </p>
    </main>
  );
}
