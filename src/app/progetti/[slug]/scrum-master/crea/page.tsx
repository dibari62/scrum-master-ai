import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import {
  defaultScrumAgentName,
  organizationIdSchema,
  projectIdSchema,
  projectSchema,
  sprintSchema,
  DEFAULT_SPRINT_LENGTH_DAYS,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { auth } from "@/lib/auth";
import { loadAgent, mayConfigureAgent } from "@/lib/agents/scrum-agent";
import { typicalSprintLengthDays } from "@/metrics";

import { CreateAgentWizard } from "./wizard";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Crea lo Scrum Master AI · ${slug} · Scrum Master AI` };
}

export default async function CreateAgentPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  const { slug } = await params;
  const organizationId = organizationIdSchema.parse(session.organizationId);
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) notFound();

  const project = projectSchema.parse(projectRow);
  const projectId = projectIdSchema.parse(project.id);

  // Already created: sending someone to a form that will refuse them is worse
  // than sending them where the thing they wanted already is.
  const existing = await loadAgent(organizationId, projectId);
  if (existing) redirect(`/progetti/${slug}/scrum-master`);

  if (!mayConfigureAgent(session.role)) {
    return (
      <main className="mx-auto grid max-w-lg gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Serve un amministratore</h1>
        <p className="text-muted-foreground text-sm">
          La configurazione dello Scrum Master AI decide cosa il sistema dirà agli
          stakeholder, quindi è riservata a chi amministra l&apos;azienda. Chiedi a un
          amministratore di crearlo.
        </p>
        <p className="text-sm">
          <Link href={`/progetti/${slug}`} className="underline underline-offset-4">
            Torna al progetto
          </Link>
        </p>
      </main>
    );
  }

  const sprintRows = await scope.reads.sprintsByProject(projectId);
  const sprints = sprintRows.map((row) => sprintSchema.parse(row));

  /*
   * Proposed by code, never by a model (R1).
   *
   * The wizard shows where the number came from: a value presented without its
   * provenance gets taken for a measurement, and this one is a suggestion.
   */
  const typical = typicalSprintLengthDays(sprints);

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <header className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/progetti" className="underline underline-offset-4">
            Progetti
          </Link>
          {" · "}
          <Link href={`/progetti/${slug}`} className="underline underline-offset-4">
            {project.name}
          </Link>
        </p>

        <h1 className="text-2xl font-semibold tracking-tight">Crea lo Scrum Master AI</h1>

        <p className="text-muted-foreground text-sm">
          Quattro passi, tutti già compilati. Puoi confermare così com&apos;è.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <CreateAgentWizard
            slug={slug}
            proposedName={defaultScrumAgentName(project.name)}
            proposedSprintLength={
              typical.available ? typical.value : DEFAULT_SPRINT_LENGTH_DAYS
            }
            sprintLengthSource={typical.available ? "osservata" : "predefinita"}
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Lo Scrum Master AI non è un modello addestrato: è una configurazione, una memoria e
        un insieme di capacità, istanziata per questo progetto.
      </p>
    </main>
  );
}
