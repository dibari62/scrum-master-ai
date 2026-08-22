import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetricCard } from "@/components/charts/metric-card";
import { Timeline, type TimelineEntry } from "@/components/charts/timeline";

const DAY = 24 * 60 * 60 * 1000;

const ENTRIES: readonly TimelineEntry[] = [
  {
    label: "Da fare",
    enteredAt: new Date("2026-05-01T09:00:00Z"),
    leftAt: new Date("2026-05-04T09:00:00Z"),
    duration: 3 * DAY,
    nature: "idle",
  },
  {
    label: "In lavorazione",
    enteredAt: new Date("2026-05-04T09:00:00Z"),
    leftAt: new Date("2026-05-05T09:00:00Z"),
    duration: DAY,
    nature: "work",
    actor: "Giulia Rossi",
  },
  {
    label: "In revisione",
    enteredAt: new Date("2026-05-05T09:00:00Z"),
    leftAt: null,
    duration: 4 * DAY,
    nature: "queue",
  },
];

/**
 * Rendered on the server, like the charts beside them: these pages exist so a
 * reader can check a number, and a number that only appears after hydration
 * cannot be checked by a screen reader or by a page loaded without JavaScript.
 */
describe("linea del tempo", () => {
  const markup = renderToStaticMarkup(<Timeline entries={ENTRIES} />);

  it("scrive ogni stato attraversato", () => {
    expect(markup).toContain("Da fare");
    expect(markup).toContain("In lavorazione");
    expect(markup).toContain("In revisione");
  });

  it("dice quanto è durata ogni permanenza", () => {
    // 3 giorni, 1 giorno, 4 giorni: sono i numeri da cui si ricava tutto.
    expect(markup).toContain("3 giorni");
    expect(markup).toContain("1 giorno");
    expect(markup).toContain("4 giorni");
  });

  it("distingue lavorazione e attesa, che è la decisione presa su Q1", () => {
    // Se questa distinzione sparisse, la pagina mostrerebbe l'attesa in
    // revisione come se fosse lavoro — l'errore che Q1 ha corretto.
    expect(markup).toContain("lavorazione");
    expect(markup).toContain("attesa");
  });

  it("dichiara aperta l'ultima permanenza invece di inventarne la fine", () => {
    expect(markup).toContain("adesso");
  });

  it("uno stato terminale è un istante, non una durata che continua", () => {
    // stateIntervals porta l'ultima permanenza fino all'istante di
    // riferimento, ed è giusto per le metriche: serve a rispondere «da quanto
    // è fermo». Stampato così com'è diceva «Concluso · 107 giorni» su un
    // elemento chiuso a maggio, come se stesse ancora succedendo qualcosa.
    const closed = renderToStaticMarkup(
      <Timeline
        entries={[
          {
            label: "Concluso",
            enteredAt: new Date("2026-05-07T16:00:00Z"),
            leftAt: null,
            duration: 107 * DAY,
            nature: "done",
          },
        ]}
      />,
    );

    expect(closed).toContain("Concluso");
    expect(closed).not.toContain("107 giorni");
    expect(closed).not.toContain("adesso");
  });

  it("dice chi ha mosso l'elemento, quando la fonte lo riporta", () => {
    expect(markup).toContain("Giulia Rossi");
  });

  it("dichiara l'assenza di storia invece di mostrare una linea vuota", () => {
    const empty = renderToStaticMarkup(<Timeline entries={[]} />);

    expect(empty).toContain("Nessuna transizione");
    expect(empty).not.toContain("<ol");
  });
});

describe("riquadro metrica apribile", () => {
  it("diventa un collegamento quando la metrica ha un dettaglio da mostrare", () => {
    const markup = renderToStaticMarkup(
      <MetricCard
        label="Cycle time mediano"
        value="2,8 giorni"
        detail="su 44 elementi"
        href="/progetti/checkout/elementi?conclusi=1"
      />,
    );

    expect(markup).toContain('href="/progetti/checkout/elementi?conclusi=1"');
    expect(markup).toContain("2,8 giorni");
  });

  it("resta un riquadro inerte senza indirizzo: nessun collegamento che non porta da nessuna parte", () => {
    const markup = renderToStaticMarkup(
      <MetricCard label="Cycle time mediano" value="2,8 giorni" detail="su 44 elementi" />,
    );

    expect(markup).not.toContain("<a");
  });

  it("mostra l'assenza di valore anche quando è apribile", () => {
    const markup = renderToStaticMarkup(
      <MetricCard
        label="Velocity"
        value={null}
        detail="nessuna stima"
        href="/progetti/checkout/elementi"
      />,
    );

    expect(markup).toContain("—");
    expect(markup).not.toContain(">0<");
  });
});
