import { describe, expect, it } from "vitest";

import { countRefusals } from "@/lib/jobs/scheduled-sync";
import { projectIdSchema } from "@/domain";

/**
 * Che cosa racconta un giro di lettura schedulata.
 *
 * **Il difetto che questo file blocca, trovato provando il job sul database
 * vero.** Un progetto con il token mancante o illeggibile viene *rifiutato*
 * prima di telefonare: nessuna eccezione, nessuna riga. Nel riepilogo risultava
 * «0 righe, 0 fallimenti» — indistinguibile da «non c'era niente di nuovo».
 *
 * È la peggiore delle due somiglianze, perché un rifiuto **non sposta il
 * segnatempo**: quel progetto resta scaduto per sempre e viene ritentato a ogni
 * giro, in silenzio, finché qualcuno non apre le impostazioni per caso.
 */

const PROJECT = projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905");
const OTHER = projectIdSchema.parse("1b4e7a92-5c8d-4306-9f21-7a3c5e8b0d64");

function summary(statuses: readonly ("done" | "failed" | "refused")[]) {
  return {
    projectsExamined: statuses.length,
    projectsDue: statuses.length,
    outcomes: statuses.map((status, index) => ({
      projectId: index === 0 ? PROJECT : OTHER,
      slug: `progetto-${index}`,
      status,
      rows: status === "done" ? 10 : 0,
    })),
  };
}

describe("il riepilogo di un giro schedulato", () => {
  it("conta i rifiuti, che altrimenti sembrano «niente di nuovo»", () => {
    expect(countRefusals(summary(["refused"]))).toBe(1);
    expect(countRefusals(summary(["done", "refused", "refused"]))).toBe(2);
  });

  it("non conta come rifiuto una lettura riuscita che non ha portato righe", () => {
    /*
     * La distinzione che dà valore al conteggio: «ho chiesto e non c'era
     * niente» è un successo, «non ho potuto chiedere» è una configurazione
     * rotta. Confonderli renderebbe il numero inutile.
     */
    expect(countRefusals(summary(["done"]))).toBe(0);
  });

  it("non conta come rifiuto un fallimento di rete", () => {
    // Un fallimento è già contato altrove, e le due cose portano a gesti
    // diversi: riprovare, oppure andare a sistemare il token.
    expect(countRefusals(summary(["failed"]))).toBe(0);
  });
});
