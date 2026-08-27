import type { ReactNode } from "react";

import { ProjectTabs, type ProjectTab } from "@/components/navigation/project-tabs";

/**
 * Frame for every page of a single project.
 *
 * The section bar lives here rather than on the dashboard so that no project
 * page can exist without a way to the others. The row of buttons it replaces
 * had exactly that flaw: it was on one screen, so every other screen was a
 * one-way trip.
 *
 * The route table is declared **once**, here. Adding a section means adding a
 * line to this list, and it then appears on every page at once — which is the
 * property the previous arrangement lacked, and the reason a page once shipped
 * that could only be reached by typing its address.
 */
export default async function ProjectLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const base = `/progetti/${slug}`;

  const tabs: readonly ProjectTab[] = [
    // `exact` solo qui: ogni altra sezione sta "sotto" la panoramica, e senza
    // la distinzione risulterebbero accese due voci su ogni pagina.
    { label: "Panoramica", href: base, exact: true },
    { label: "Backlog", href: `${base}/backlog` },
    { label: "Elementi", href: `${base}/elementi` },
    { label: "Sprint", href: `${base}/sprint` },
    { label: "Flusso", href: `${base}/flusso` },
    { label: "Persone", href: `${base}/persone` },
    { label: "Impedimenti", href: `${base}/impedimenti` },
    { label: "Retrospettive", href: `${base}/retrospettive` },
    { label: "Scrum Master AI", href: `${base}/scrum-master` },
    /*
     * Ultima, e non è un ripensamento.
     *
     * Le altre voci sono cose da guardare; questa è una cosa da *fare*, e si fa
     * una volta. Metterla in mezzo la offrirebbe ogni giorno a chi l'ha già
     * fatta, e in fondo la trova comunque chi la cerca — perché è dove ci si
     * aspetta che stiano le impostazioni.
     */
    { label: "Impostazioni", href: `${base}/impostazioni` },
  ];

  return (
    <>
      <ProjectTabs tabs={tabs} />
      {children}
    </>
  );
}
