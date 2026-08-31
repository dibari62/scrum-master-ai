import { organizationIdSchema } from "@/domain";
import { getDatabase } from "@/db";
import { organizations } from "@/db/schema";
import { authoriseJob } from "@/lib/jobs/authorise";
import { countRefusals, synchroniseOrganization } from "@/lib/jobs/scheduled-sync";
import { checkOrganizationHealth } from "@/lib/jobs/sprint-health-check";
import { logger } from "@/lib/logger";

/**
 * La lettura schedulata, su HTTP.
 *
 * Sottile come l'altra: autorizza, fissa l'istante, delega. Tutto ciò che decide
 * sta in `src/lib/jobs`, che sono funzioni normali e quindi verificabili.
 *
 * **Un solo timer per tutti i progetti, e la decisione nel codice.** Lo
 * schedulatore chiama questa rotta a intervalli fissi senza sapere nulla dei
 * progetti; è `isDue` a stabilire quali siano scaduti. L'alternativa — una
 * iscrizione allo schedulatore per ogni progetto — metterebbe il ritmo in due
 * posti, e il giorno in cui qualcuno lo cambia dall'interfaccia il servizio
 * esterno resterebbe indietro senza che nulla lo segnali.
 *
 * **Dopo aver letto, giudica.** La salute dello sprint viene registrata nello
 * stesso giro e non da un secondo timer: valutarla prima della lettura
 * significherebbe scrivere ogni volta il giudizio di ieri, che è il modo più
 * silenzioso di rendere inutile uno storico.
 *
 * `POST` e non `GET` perché scrive. Un `GET` che cambia dati prima o poi viene
 * seguito da un controllo di collegamenti o da un prefetch, e il job risulterà
 * partito da solo.
 */

export const dynamic = "force-dynamic";

/**
 * Il tetto di tempo che questa rotta si concede.
 *
 * Una lettura vera dura pochi secondi su un progetto piccolo, ma cresce con la
 * storia: senza un tetto esplicito la piattaforma ne impone uno proprio, molto
 * più corto, e il giro si interromperebbe a metà dell'elenco lasciando gli
 * ultimi progetti indietro **senza un errore**.
 */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const authorisation = authoriseJob(request.headers);

  if (!authorisation.ok) {
    if (authorisation.reason === "misconfigured") {
      logger.error("job.sync.misconfigured", {
        detail: authorisation.detail ?? "name-missing",
        message:
          authorisation.detail === "value-empty"
            ? "JOB_SECRET arriva con il nome presente e il valore vuoto: su Vercel è il tipo «Secret». Va ricreata come «Config»."
            : "JOB_SECRET non impostata: la rotta rifiuta ogni chiamata.",
      });

      return Response.json(
        {
          error: "Job non configurato.",
          /*
           * Il dettaglio esce anche di qui, e non è una svista.
           *
           * Non rivela nulla: dice che *manca* un segreto, non quale sia né
           * quanto sia lungo. Chi chiama questa rotta è uno schedulatore o chi
           * lo sta configurando, e sono le due sole persone al mondo per cui la
           * differenza fra «non l'hai creata» e «l'hai creata del tipo
           * sbagliato» vale un pomeriggio.
           */
          detail: authorisation.detail ?? "name-missing",
          suggerimento:
            authorisation.detail === "value-empty"
              ? "La variabile JOB_SECRET esiste ma arriva vuota: su Vercel ricreala con Type «Config». Vedi /organizzazione/ambiente."
              : "Manca la variabile JOB_SECRET. Vedi /organizzazione/ambiente.",
        },
        { status: 500 },
      );
    }

    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  const asOf = new Date();

  const rows = await getDatabase().select({ id: organizations.id }).from(organizations);

  let projectsExamined = 0;
  let projectsDue = 0;
  let rowsIngested = 0;
  let failures = 0;
  let refusals = 0;
  let checksRecorded = 0;

  for (const row of rows) {
    const organizationId = organizationIdSchema.parse(row.id);

    const summary = await synchroniseOrganization(organizationId, asOf);

    projectsExamined += summary.projectsExamined;
    projectsDue += summary.projectsDue;
    refusals += countRefusals(summary);

    for (const outcome of summary.outcomes) {
      rowsIngested += outcome.rows;
      if (outcome.status === "failed") failures += 1;
    }

    /*
     * Il giudizio si scrive **dopo** la lettura, e solo se qualcosa è entrato.
     *
     * Rivalutare la salute quando nessun progetto era scaduto scriverebbe una
     * riga identica a quella di prima: uno storico fatto di ripetizioni rende
     * difficile vedere il giorno in cui qualcosa è cambiato davvero. Il job
     * della salute continua a girare per conto suo, con il proprio ritmo.
     */
    if (summary.projectsDue > 0) {
      const health = await checkOrganizationHealth(organizationId, asOf);
      checksRecorded += health.checksRecorded;
    }
  }

  logger.info("job.sync.done", {
    organizations: rows.length,
    projectsExamined,
    projectsDue,
    rowsIngested,
    failures,
    refusals,
    checksRecorded,
  });

  return Response.json({
    takenAt: asOf.toISOString(),
    organizations: rows.length,
    projectsExamined,
    projectsDue,
    rowsIngested,
    failures,
    /*
     * I rifiuti si contano a parte, e non è pignoleria contabile.
     *
     * Un progetto rifiutato non ha nemmeno telefonato — manca il token, o non è
     * leggibile — quindi non è un fallimento di rete e non ha portato righe. Nel
     * riepilogo risultava «0 righe, 0 fallimenti», cioè identico a «non c'era
     * niente di nuovo». Ma un rifiuto **non sposta il segnatempo**: quel
     * progetto resta scaduto per sempre, e ogni giro lo ritenta in silenzio.
     */
    refusals,
    checksRecorded,
  });
}
