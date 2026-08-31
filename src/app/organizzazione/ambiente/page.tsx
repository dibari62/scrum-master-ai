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
import {
  custodyDetail,
  deploymentFacts,
  environmentReport,
  readingProbes,
  type EnvironmentEntry,
} from "@/lib/environment/report";
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
  const deploy = deploymentFacts();
  const probes = readingProbes();

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
          <h2 className="text-sm font-medium">Questo deploy</h2>
          <p className="text-muted-foreground text-sm">
            Serve a capire <strong>a chi</strong> stai guardando le variabili. Una
            variabile presente nel pannello e assente qui sotto significa quasi sempre
            che il deploy è precedente, oppure che questo server gira in un ambiente
            diverso da quello in cui l&apos;hai messa.
          </p>

          <div className="grid gap-1 rounded-md border p-3 text-sm">
            {deploy.onVercel ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Ambiente</span>
                  <code className="font-mono">{deploy.environment ?? "sconosciuto"}</code>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Commit</span>
                  <code className="font-mono">{deploy.commit ?? "sconosciuto"}</code>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Ramo</span>
                  <code className="font-mono">{deploy.branch ?? "sconosciuto"}</code>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Indirizzo del deploy</span>
                  <code className="font-mono text-xs">{deploy.url ?? "sconosciuto"}</code>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Variabili viste in tutto</span>
                  <code className="font-mono">{deploy.variableCount}</code>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                Non su Vercel: questo server gira in locale, e le variabili vengono da{" "}
                <code className="font-mono">.env.local</code>.
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-medium">
            Nomi che il server vede davvero ({deploy.applicationNames.length})
          </h2>
          <p className="text-muted-foreground text-sm">
            Solo i <strong>nomi</strong>, mai i valori, e solo quelli che riguardano
            l&apos;applicazione. Serve al confronto che chiude una diagnosi: «nel pannello
            ne vedo sei, il server ne vede due».
          </p>

          <div className="rounded-md border p-3">
            {deploy.applicationNames.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nessuna.</p>
            ) : (
              <ul className="grid gap-1">
                {deploy.applicationNames.map((name) => (
                  <li key={name}>
                    <code className="font-mono text-sm">{name}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-sm font-medium">Come si legge una variabile</h2>
          <p className="text-muted-foreground text-sm">
            La stessa variabile chiesta in quattro modi, che differiscono solo per quanto
            un bundler riesce a capirli. Se una colonna risponde e le altre no, il rimedio
            è nel codice; se non risponde nessuna, la variabile non raggiunge il processo
            e il rimedio è nel pannello. Nessun valore è mostrato: solo se la lettura ha
            prodotto qualcosa.
          </p>

          <div className="grid gap-2 rounded-md border p-3 text-sm">
            {probes.map((probe) => (
              <div key={probe.name} className="grid gap-1">
                <code className="font-mono">{probe.name}</code>
                <div className="text-muted-foreground grid gap-0.5 pl-3">
                  <span>letterale (process.env.NOME): {probe.letterale ? "sì" : "no"}</span>
                  <span>oggetto (process.env[nome]): {probe.oggetto ? "sì" : "no"}</span>
                  <span>globalThis.process.env[nome]: {probe.globale ? "sì" : "no"}</span>
                  <span>nome composto a runtime: {probe.nomeSpezzato ? "sì" : "no"}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

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
          <p>
            <strong>E che sia il progetto giusto.</strong> Un account può avere più
            progetti su Vercel, e le variabili appartengono a uno solo: il ramo e il
            commit qui sopra dicono quale sta rispondendo davvero a questo indirizzo.
          </p>
          <p>
            <strong>
              Se una riga dice «il nome esiste, il valore è vuoto», è il tipo della
              variabile.
            </strong>{" "}
            Su Vercel una variabile di tipo <strong>Secret</strong> raggiunge il processo
            con il nome presente e il contenuto vuoto — lo conferma la sezione qui sopra,
            dove nessuna forma di lettura la trova. Cancellala e ricreala con tipo{" "}
            <strong>Config</strong>: non significa pubblica, resta visibile a chi ha
            accesso al progetto. Una chiave che non arriva non protegge nulla.
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

      {entry.state !== "present" ? (
        <p className="text-muted-foreground text-sm">
          Forma del valore:{" "}
          <code className="font-mono">
            {entry.shape === "missing-key"
              ? "il nome non esiste nell'ambiente"
              : entry.shape === "empty"
                ? "il nome esiste, il valore è vuoto"
                : "valorizzata"}
          </code>
        </p>
      ) : null}

      {entry.bundlerFroze ? (
        <p className="text-sm">
          <strong>Attenzione:</strong> al runtime questa variabile è valorizzata, ma il
          pacchetto compilato ne porta una copia <strong>vuota</strong>, congelata in fase
          di build. Un modulo che la leggesse con un riferimento letterale otterrebbe il
          vuoto. È il difetto documentato in{" "}
          <code className="font-mono">ripartire-da-zero.md</code> §5.quater.
        </p>
      ) : null}

      {entry.consequence ? (
        <p className="text-sm">
          <strong>Senza:</strong> {entry.consequence}
        </p>
      ) : null}

      {detail ? <p className="text-sm">{detail}</p> : null}
    </div>
  );
}
