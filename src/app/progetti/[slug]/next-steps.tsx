import Link from "next/link";

import type { Onboarding } from "@/lib/projects/onboarding";

/**
 * Che cosa fare adesso, su un progetto che non fa ancora nulla.
 *
 * **Il difetto che questa sezione ripara.** La dashboard di un progetto appena
 * creato mostra nove metriche vuote: «—», «campione vuoto», «nessun dato». Ogni
 * riga è corretta e nessun numero è inventato, ma messe insieme dicono
 * «guasto» a chi ha appena premuto «Crea il progetto» — e non dicono da nessuna
 * parte che manca semplicemente una fonte dati.
 *
 * **Sparisce da sola.** Quando non resta alcun passo, il componente non rende
 * nulla: una sezione «cosa fare» che resta accesa su un progetto configurato
 * diventa rumore, e il rumore si impara a ignorare insieme a tutto il resto.
 *
 * **Due pesi, non uno.** Con i dati collegati la dashboard è piena di numeri
 * veri e i passi rimasti sono un suggerimento, quindi la sezione è discreta.
 * Senza dati la dashboard è vuota e questa è l'unica cosa che vale la pena
 * leggere, quindi occupa il posto che le compete.
 */
export function NextSteps({ state }: { readonly state: Onboarding }) {
  if (state.remaining === 0) return null;

  return (
    <section
      aria-labelledby="primi-passi"
      className={
        state.empty
          ? "border-primary/30 bg-primary/5 grid gap-4 rounded-lg border p-5"
          : "grid gap-4 rounded-lg border p-5"
      }
    >
      <header className="grid gap-1">
        <h2 id="primi-passi" className="text-base font-semibold">
          {state.empty ? "Il progetto è pronto, i dati no" : "Cosa puoi ancora aggiungere"}
        </h2>
        <p className="text-muted-foreground text-sm">
          {state.empty
            ? "Le schermate qui sotto sono vuote perché non c'è ancora nulla da mostrare, non perché qualcosa non funzioni. Ecco da dove si comincia."
            : "Il progetto funziona già. Questi passi aggiungono qualcosa, e si possono fare quando vuoi."}
        </p>
      </header>

      <ol className="grid gap-3">
        {state.steps.map((step, index) => (
          <li key={step.id}>
            <div
              className={
                step.done
                  ? "text-muted-foreground flex gap-3 rounded-md border p-3"
                  : "flex gap-3 rounded-md border p-3"
              }
            >
              {/*
               * Il numero, non una spunta verde.
               *
               * Una spunta su ciò che è fatto e un cerchio vuoto su ciò che
               * manca leggono come una percentuale di completamento, e un
               * progetto con la sola fonte dati collegata è già pienamente
               * utilizzabile: dirgli «1 di 3» sarebbe una bugia.
               */}
              <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                {step.done ? "✓" : `${index + 1}.`}
              </span>

              <div className="grid gap-1">
                {step.done ? (
                  <p className="text-sm font-medium">{step.title}</p>
                ) : (
                  <p className="text-sm font-medium">
                    <Link href={step.href} className="underline underline-offset-4">
                      {step.title}
                    </Link>
                  </p>
                )}

                <p className="text-muted-foreground text-sm">{step.benefit}</p>
                {step.hint ? <p className="text-muted-foreground text-sm">{step.hint}</p> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
