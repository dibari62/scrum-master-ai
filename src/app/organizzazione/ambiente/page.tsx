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
import { auth } from "@/lib/auth";
import { custodyDetail, environmentReport, type EnvironmentEntry } from "@/lib/environment/report";
import { mayConfigureSettings } from "@/lib/projects/settings";

export const metadata: Metadata = {
  title: "Ambiente del server · Scrum Master AI",
};

/**
 * Che cosa il server vede davvero.
 *
 * **Perché questa pagina esiste.** `node scripts/check-env.mjs` risponde alla
 * stessa domanda sul portatile; online non c'era modo di rispondervi. Una
 * variabile mancante su Vercel si manifestava come un avviso rosso in fondo a
 * una schermata di configurazione, e chi la aggiungeva non aveva modo di sapere
 * se fosse arrivata, se fosse arrivata **nell'ambiente giusto**, o se mancasse
 * solo un nuovo deploy — perché ogni tentativo produceva la stessa schermata di
 * quello prima.
 *
 * Non è una pagina di lusso: è nata da un giro di verifiche che ha richiesto di
 * entrare nel sito pubblicato con un account temporaneo per leggere una frase.
 * Adesso la stessa risposta si ottiene aprendo un indirizzo.
 *
 * **Nessun valore compare qui**, e un test lo verifica sulla forma del
 * risultato. L'unica misura mostrata è la lunghezza di `SECRETS_KEY` quando è
 * sbagliata, perché la lunghezza attesa è pubblica e senza quel numero l'errore
 * è invisibile.
 *
 * Riservata a chi può configurare: non perché il contenuto sia segreto — non lo
 * è — ma perché è una risposta che serve a chi ha il potere di agire.
 */
export const dynamic = "force-dynamic";

export default async function EnvironmentPage() {
  const session = await auth();
  if (!session) redirect("/accedi");

  if (!mayConfigureSettings(session.role)) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Non disponibile</CardTitle>
          <CardDescription>
            Lo stato dell&apos;ambiente lo vede chi può configurare il portale: il
            proprietario o un amministratore.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const report = environmentReport();
  const detail = custodyDetail();

  const required = report.entries.filter((entry) => entry.severity === "required");
  const optional = report.entries.filter((entry) => entry.severity === "optional");

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardDescription>Diagnostica</CardDescription>
        <CardTitle className="text-2xl">Ambiente del server</CardTitle>
        <CardDescription>
          Che cosa questo server vede nelle proprie variabili d&apos;ambiente, adesso.
          Nessun valore è mostrato: solo se una variabile c&apos;è, e se ha la forma
          giusta.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6">
        <p
          className={
            report.problems === 0
              ? "rounded-md border px-3 py-2 text-sm"
              : "border-destructive/40 text-destructive rounded-md border px-3 py-2 text-sm"
          }
          role={report.problems === 0 ? undefined : "alert"}
        >
          {report.problems === 0
            ? "Tutte le variabili necessarie sono presenti."
            : `Mancano o non sono valide ${report.problems} variabili necessarie. Il dettaglio è qui sotto.`}
        </p>

        <section className="grid gap-3">
          <h2 className="text-sm font-medium">Necessarie</h2>
          {required.map((entry) => (
            <EntryRow
              key={entry.name}
              entry={entry}
              detail={entry.name === "SECRETS_KEY" ? detail : null}
            />
          ))}
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-medium">Facoltative</h2>
          <p className="text-muted-foreground text-sm">
            Senza queste il portale funziona: una funzione semplicemente non compare.
          </p>
          {optional.map((entry) => (
            <EntryRow key={entry.name} entry={entry} detail={null} />
          ))}
        </section>

        <div className="text-muted-foreground grid gap-2 rounded-md border p-3 text-sm">
          <p>
            <strong>Se hai appena aggiunto una variabile e la vedi ancora assente:</strong>{" "}
            le variabili si leggono <strong>all&apos;avvio</strong>, non a caldo. Serve un
            nuovo deploy perché il server le veda.
          </p>
          <p>
            Verifica anche che sia stata aggiunta all&apos;ambiente{" "}
            <strong>Production</strong>: una variabile presente solo su Preview non
            raggiunge il sito pubblicato.
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href="/organizzazione">Torna all&apos;azienda</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const STATE_WORDS = {
  present: "presente",
  absent: "assente",
  invalid: "non valida",
} as const;

function EntryRow({
  entry,
  detail,
}: {
  readonly entry: EnvironmentEntry;
  readonly detail: string | null;
}) {
  const bad = entry.state !== "present";

  return (
    <div className="grid gap-1 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="font-mono text-sm">{entry.name}</code>
        <span
          className={bad && entry.severity === "required" ? "text-destructive text-sm" : "text-sm"}
        >
          {STATE_WORDS[entry.state]}
        </span>
      </div>

      <p className="text-muted-foreground text-sm">{entry.purpose}</p>

      {entry.consequence ? (
        <p className="text-sm">
          <strong>Senza:</strong> {entry.consequence}
        </p>
      ) : null}

      {detail ? <p className="text-sm">{detail}</p> : null}
    </div>
  );
}
