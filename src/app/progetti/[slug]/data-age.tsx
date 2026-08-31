import Link from "next/link";

import { describeAge, type DataFreshness } from "@/lib/projects/freshness";

/**
 * Da quando sono fermi i dati, detto sulla schermata che li mostra.
 *
 * **Perché sta qui e non nelle impostazioni.** Nelle impostazioni la data
 * dell'ultima lettura c'è già, ed è il posto giusto per chi sta configurando.
 * Ma chi guarda un burndown non passa di lì: legge i numeri e li crede
 * attuali, perché non c'è ragione di pensare il contrario.
 *
 * Due pesi, e uno solo attira l'attenzione. Sotto le ventiquattro ore è una
 * riga di servizio, grigia come le altre. Oltre, diventa un avviso — non perché
 * i numeri siano sbagliati, ma perché descrivono uno sprint che nel frattempo è
 * andato avanti.
 */
export function DataAge({
  freshness,
  slug,
}: {
  readonly freshness: DataFreshness;
  readonly slug: string;
}) {
  if (freshness.kind === "not-applicable") return null;

  const impostazioni = `/progetti/${slug}/impostazioni?sezione=dati`;

  if (freshness.kind === "never") {
    /*
     * «Mai letto» non è un avviso: è il primo passo, e i primi passi hanno già
     * il loro riquadro qui sopra. Ripeterlo in rosso direbbe che qualcosa si è
     * rotto quando invece non è ancora cominciato.
     */
    return (
      <p className="text-muted-foreground text-sm">
        Nessuna lettura da Jira finora.{" "}
        <Link href={impostazioni} className="underline underline-offset-4">
          Leggi i dati
        </Link>
        .
      </p>
    );
  }

  const quando = describeAge(freshness.hours);

  if (freshness.kind === "fresh") {
    return (
      <p className="text-muted-foreground text-sm">
        Dati letti da Jira {quando}.{" "}
        <Link href={impostazioni} className="underline underline-offset-4">
          Rileggi
        </Link>
        .
      </p>
    );
  }

  return (
    <p className="border-muted-foreground/40 rounded-md border border-dashed px-3 py-2 text-sm">
      <strong>Dati letti da Jira {quando}.</strong> I numeri qui sotto sono corretti per
      quei dati, ma lo sprint nel frattempo è andato avanti: la lettura non parte da
      sola.{" "}
      <Link href={impostazioni} className="underline underline-offset-4">
        Rileggi ora
      </Link>
      .
    </p>
  );
}
