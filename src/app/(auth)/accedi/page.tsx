import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isGitHubConfigured } from "@/lib/auth/config";

import { signInWithGitHubAction } from "../actions";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Accedi · Scrum Master AI",
};

/**
 * Rendered per request rather than prerendered.
 *
 * Whether GitHub is configured is deployment state, and `authConfig` reads it
 * on every request. A page frozen at build time could therefore disagree with
 * the backend — hiding a provider that works, or offering one that does not.
 */
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Accedi</CardTitle>
        <CardDescription>Entra nell&apos;area della tua azienda.</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-5">
        <SignInForm />

        {/* Drawn only when the provider is actually configured: a button that
            cannot work is worse than one that is absent. */}
        {isGitHubConfigured() ? (
          <>
            <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
              <span className="bg-border h-px flex-1" />
              oppure
              <span className="bg-border h-px flex-1" />
            </div>

            <form action={signInWithGitHubAction}>
              <Button type="submit" variant="outline" className="w-full">
                Continua con GitHub
              </Button>
            </form>
          </>
        ) : null}
      </CardContent>

      <CardFooter className="text-muted-foreground text-sm">
        <p>
          Non hai ancora un account?{" "}
          <Link href="/registrati" className="text-foreground underline underline-offset-4">
            Registra la tua azienda
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
