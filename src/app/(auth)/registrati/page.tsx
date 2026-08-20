import type { Metadata } from "next";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { RegistrationForm } from "./registration-form";

export const metadata: Metadata = {
  title: "Registra la tua azienda · Scrum Master AI",
};

export default function RegistrationPage() {
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Registra la tua azienda</CardTitle>
        <CardDescription>
          Crei l&apos;account aziendale e ne diventi il proprietario. I progetti si
          aggiungono dopo.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <RegistrationForm />
      </CardContent>

      <CardFooter className="text-muted-foreground text-sm">
        <p>
          Hai già un account?{" "}
          <Link href="/accedi" className="text-foreground underline underline-offset-4">
            Accedi
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
