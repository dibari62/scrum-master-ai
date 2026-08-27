import type { StoredForecastMethod } from "@/domain";
import { formatNumber } from "@/lib/format";

import type { SprintMetrics } from "../data";

/**
 * Previsto contro effettivo, per ogni sprint.
 *
 * **Perché è una tabella e non un grafico.** Il numero che conta qui è lo
 * *scostamento*, e su un grafico a barre affiancate lo si legge come distanza
 * fra due altezze — che è proprio il confronto che l'occhio fa peggio. Scritto,
 * porta il segno e l'unità e non chiede di essere stimato a vista.
 *
 * Di sola presentazione (§4): riceve numeri già calcolati da `src/metrics` e su
 * di essi non decide nulla.
 */

const METHOD_LABELS: Readonly<Record<StoredForecastMethod, string>> = {
  "yesterdays-weather": "meteo di ieri",
  "focus-factor": "focus factor",
  "default-focus-factor": "focus factor predefinito (70%)",
};

/**
 * La ritrattazione dell'autore, mostrata dove compare il numero.
 *
 * ADR-0008 decide che il focus factor resta disponibile **con** la ritrattazione
 * accanto, non nascosta in una nota. Un portale che insegna una pratica che
 * l'autore del libro definisce dannosa, senza dirlo, sta insegnando male.
 */
const RETRACTED_METHODS: ReadonlySet<StoredForecastMethod> = new Set([
  "focus-factor",
  "default-focus-factor",
]);

/**
 * Quanti punti chiave stanno in una cella prima di diventare un muro di testo.
 *
 * Tre: una retrospettiva ne produce dodici, e riportarli tutti trasformerebbe
 * una tabella di confronto in un verbale. Il resto si conta, e la pagina delle
 * retrospettive li ha tutti.
 */
const KEY_POINTS_SHOWN = 3;

function varianceText(sprint: SprintMetrics): { text: string; tone: string } {
  const variance = sprint.forecastVariance;

  if (!variance) return { text: "—", tone: "text-muted-foreground" };
  if (!variance.available) {
    return { text: "non calcolabile", tone: "text-muted-foreground" };
  }

  const value = variance.value;

  // Lo zero esatto merita la sua parola: «+0» si legge come un arrotondamento.
  if (value === 0) return { text: "in linea", tone: "text-muted-foreground" };

  const sign = value > 0 ? "+" : "−";
  return {
    text: `${sign}${formatNumber(Math.abs(value), 1)} punti`,
    tone: value > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
  };
}

export function ForecastTable({ sprints }: { readonly sprints: readonly SprintMetrics[] }) {
  const withForecast = sprints.filter((entry) => entry.forecast !== null);

  if (withForecast.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nessuna previsione registrata per questo progetto. La previsione si scrive
        all&apos;inizio dello sprint e non si ricostruisce dopo: rifarla adesso
        significherebbe deciderla di nuovo, con dati che il piano non aveva.
      </p>
    );
  }

  const anyRetracted = withForecast.some(
    (entry) => entry.forecast !== null && RETRACTED_METHODS.has(entry.forecast.method),
  );

  return (
    <div className="grid gap-3">
      {/* Scorrimento orizzontale: su telefono cinque colonne non ci stanno, e
          rimpicciolire il testo lo renderebbe illeggibile invece che compatto. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">
            Velocity prevista e effettiva per ogni sprint, con lo scostamento
          </caption>
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th scope="col" className="py-2 pr-3 font-medium">Sprint</th>
              <th scope="col" className="py-2 pr-3 font-medium">Previsto</th>
              <th scope="col" className="py-2 pr-3 font-medium">Effettivo</th>
              <th scope="col" className="py-2 pr-3 font-medium">Scostamento</th>
              <th scope="col" className="py-2 pr-3 font-medium">Metodo</th>
              {/*
               * La colonna che la checklist del capitolo 16 chiede.
               *
               * > «Update the sprint statistics page with the actual velocity
               * > **and key points from the retrospective**» (pag. 163)
               *
               * Nel libro si ricopiano a mano su un wiki. Qui le note della
               * retrospettiva esistono già come entità: si leggono da lì invece
               * di copiarle, perché due copie divergono alla prima correzione.
               */}
              <th scope="col" className="py-2 font-medium">Dalla retrospettiva</th>
            </tr>
          </thead>
          <tbody>
            {withForecast.map((entry) => {
              const forecast = entry.forecast;
              if (!forecast) return null;

              const actual =
                entry.velocity.available && entry.velocity.value.points !== null
                  ? `${formatNumber(entry.velocity.value.points, 1)} punti`
                  : "—";

              const variance = varianceText(entry);

              return (
                <tr key={entry.sprint.id} className="border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {entry.sprint.name}
                  </th>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatNumber(forecast.forecastPoints, 1)} punti
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{actual}</td>
                  <td className={`py-2 pr-3 tabular-nums ${variance.tone}`}>
                    {variance.text}
                  </td>
                  <td className="text-muted-foreground py-2 pr-3">
                    {METHOD_LABELS[forecast.method]}
                  </td>
                  <td className="text-muted-foreground py-2">
                    {entry.retrospectiveKeyPoints.length === 0 ? (
                      // Un trattino, non «nessun punto»: una retrospettiva che
                      // non ha lasciato note è diversa da una non tenuta, e
                      // questa colonna non sa distinguerle.
                      "—"
                    ) : (
                      <ul className="grid gap-0.5">
                        {entry.retrospectiveKeyPoints.slice(0, KEY_POINTS_SHOWN).map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                        {entry.retrospectiveKeyPoints.length > KEY_POINTS_SHOWN ? (
                          <li className="text-xs">
                            e altri {entry.retrospectiveKeyPoints.length - KEY_POINTS_SHOWN}
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {anyRetracted ? (
        <p className="text-muted-foreground text-xs">
          <strong>Sul focus factor.</strong> L&apos;autore del libro da cui vengono queste
          formule lo ha poi ritrattato: «non uso più il focus factor, perché richiede tempo,
          dà una falsa sensazione di precisione e obbliga a stimare le storie in
          giornate-uomo ideali». Resta calcolabile perché il capitolo sulla pianificazione ci
          poggia sopra, ma il metodo consigliato oggi è il meteo di ieri.
        </p>
      ) : null}
    </div>
  );
}
