import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { organizationIdSchema } from "@/domain";
import { auth } from "@/lib/auth";

import { loadProjects } from "./data";

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

  const projects = await loadProjects(organizationIdSchema.parse(session.organizationId));

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-6 py-12">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Progetti</h1>
        <p className="text-muted-foreground text-sm">
          Ogni progetto ha i propri sprint, il proprio flusso e le proprie metriche.
        </p>
      </header>

      {projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nessun progetto</CardTitle>
            <CardDescription>
              Per popolare un progetto con una storia sintetica esegui{" "}
              <code className="font-mono text-xs">npm run seed</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/progetti/${project.slug}`} className="block">
                <Card className="transition-colors hover:border-foreground/30">
                  <CardHeader>
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <CardDescription>
                      {project.description ?? "Nessuna descrizione."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-muted-foreground font-mono text-xs">
                    {project.slug}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-sm">
        <Link href="/organizzazione" className="underline underline-offset-4">
          Torna all&apos;area azienda
        </Link>
      </p>
    </main>
  );
}
