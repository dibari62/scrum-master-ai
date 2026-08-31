import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Breadcrumb } from "@/components/navigation/breadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { mayCreateProject } from "@/lib/projects/create";

import { CreateProjectForm } from "./project-form";

export const metadata: Metadata = {
  title: "Nuovo progetto · Scrum Master AI",
};

/** Depends on who is asking: the role decides whether the form is shown at all. */
export const dynamic = "force-dynamic";

export default async function CreateProjectPage() {
  const session = await auth();
  if (!session) redirect("/accedi");
  if (!session.organizationId) redirect("/organizzazione");

  /*
   * Il controllo è qui **e** nella server action.
   *
   * Questa pagina decide cosa mostrare; l'autorizzazione vera sta sotto, in
   * `createProject`. Un pulsante nascosto non è un'autorizzazione: l'azione
   * resta raggiungibile da chiunque sappia inviarle un modulo.
   */
  if (!mayCreateProject(session.role)) {
    return (
      <main className="mx-auto grid max-w-lg gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Serve un amministratore</h1>
        <p className="text-muted-foreground text-sm">
          Un progetto è il contenitore di sprint, elementi e metriche, e si archivia invece
          di essere cancellato: per questo la creazione è riservata a chi amministra
          l&apos;azienda. Chiedi a un amministratore di crearlo.
        </p>
        <p className="text-sm">
          <Link href="/progetti" className="underline underline-offset-4">
            Torna ai progetti
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <header className="grid gap-1">
        <Breadcrumb
          trail={[{ label: "Progetti", href: "/progetti" }, { label: "Nuovo progetto" }]}
        />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Nuovo progetto</h1>
        <p className="text-muted-foreground text-sm">
          Due campi e sei pronto. Il progetto nasce vuoto: sprint, elementi e Scrum Master
          AI si aggiungono dopo, da dentro il progetto.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dati del progetto</CardTitle>
          <CardDescription>
            Il nome è quello che leggono le persone, l&apos;identificativo è quello che
            legge il browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateProjectForm />
        </CardContent>
      </Card>

      {/*
       * L'identificativo è unico dentro l'azienda, non nel mondo.
       *
       * Vale la pena dirlo: chi arriva da altri strumenti si aspetta di dover
       * inventare un nome libero a livello globale, e finisce per scegliere
       * `checkout-acme-2026` dove `checkout` andava benissimo.
       */}
      <p className="text-muted-foreground text-xs">
        L&apos;identificativo deve essere unico solo all&apos;interno della tua azienda:
        un&apos;altra azienda può avere un progetto con lo stesso identificativo senza che
        i due si vedano.
      </p>
    </main>
  );
}
