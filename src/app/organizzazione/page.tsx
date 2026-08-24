import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { forOrganization, getDatabase } from "@/db";
import { organizationIdSchema, type OrganizationRole } from "@/domain";
import { auth } from "@/lib/auth";

import { signOutAction } from "../(auth)/actions";

export const metadata: Metadata = {
  title: "La tua azienda · Scrum Master AI",
};

const ROLE_LABELS: Readonly<Record<OrganizationRole, string>> = {
  owner: "Proprietario",
  admin: "Amministratore",
  member: "Membro",
};

/**
 * The area behind sign-in.
 *
 * Guarded by `auth()` here rather than by middleware: the middleware runs on
 * the edge runtime, where neither `node:crypto` nor the database driver used
 * by `authConfig` exist. Splitting the configuration into an edge-safe half
 * and a full one is the usual answer, but it means two files that must stay in
 * step — not worth it while the protected surface is one page.
 */
export default async function OrganizationPage() {
  const session = await auth();
  if (!session) redirect("/accedi");

  if (!session.organizationId) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Nessuna azienda collegata</CardTitle>
          <CardDescription>
            L&apos;accesso è riuscito, ma questo account non appartiene ancora a
            un&apos;azienda. Succede entrando con GitHub senza una registrazione
            precedente: la creazione di un&apos;azienda da qui non è ancora disponibile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              Esci
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  // Every read goes through the tenant scope, never through a bare database
  // handle: the filter belongs to one shared helper (§8.4).
  const scope = forOrganization(
    getDatabase(),
    organizationIdSchema.parse(session.organizationId),
  );
  const [organization] = await scope.reads.organization();

  if (!organization) redirect("/accedi");

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardDescription>Azienda</CardDescription>
        <CardTitle className="text-2xl">{organization.name}</CardTitle>
      </CardHeader>

      <CardContent className="grid gap-6">
        <dl className="grid gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Identificativo</dt>
            <dd className="font-mono">{organization.slug}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Il tuo ruolo</dt>
            <dd>{session.role ? ROLE_LABELS[session.role] : "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Accesso come</dt>
            <dd>{session.user.email}</dd>
          </div>
        </dl>

        {/*
         * The way in, not a footnote.
         *
         * This page said "i progetti arrivano con i prossimi traguardi" for a
         * while after the projects had arrived, and offered no link to them:
         * whoever signed in read that there was nothing to see and stopped.
         * It is the page every session lands on, so anything reachable has to
         * be reachable from here.
         */}
        <div className="grid gap-2">
          <Button asChild>
            <Link href="/progetti">Vai ai progetti</Link>
          </Button>

          {/*
           * The same mistake was sitting three lines below the warning against
           * it: «Lo Scrum Master AI arriva con i prossimi traguardi» stayed here
           * for three milestones after it had arrived, and after it had started
           * writing sprint reports. A promise is a claim with an expiry date and
           * nobody to enforce it; a link either works or is obviously broken.
           */}
          <Button asChild variant="outline">
            <Link href="/metriche">Come si calcolano le metriche</Link>
          </Button>
        </div>

        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Esci
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
