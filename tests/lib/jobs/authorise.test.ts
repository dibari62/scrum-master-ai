import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authoriseJob, presentedSecret } from "@/lib/jobs/authorise";
import { utcDay } from "@/lib/jobs/sprint-health-check";

/**
 * Who may trigger a scheduled job.
 *
 * This is the file where a mistake costs the most: everything else in the
 * application sits behind a session, and this is a door onto the open internet
 * with a string for a key. The tests are about **what a refusal reveals** as
 * much as about who gets in — a `401` that came back a little faster for a
 * nearly-correct secret would hand an attacker the secret one byte at a time.
 */

const SECRET = "un-segreto-abbastanza-lungo-da-essere-realistico";

function headersWith(value: string, name = "authorization"): Headers {
  return new Headers({ [name]: value });
}

let original: string | undefined;

beforeEach(() => {
  original = process.env["JOB_SECRET"];
  process.env["JOB_SECRET"] = SECRET;
});

afterEach(() => {
  if (original === undefined) delete process.env["JOB_SECRET"];
  else process.env["JOB_SECRET"] = original;
});

describe("autorizzazione di un job", () => {
  it("accetta il segreto giusto come Bearer", () => {
    expect(authoriseJob(headersWith(`Bearer ${SECRET}`)).ok).toBe(true);
  });

  it("accetta il segreto giusto in un'intestazione dedicata", () => {
    expect(authoriseJob(headersWith(SECRET, "x-job-secret")).ok).toBe(true);
  });

  it("rifiuta un segreto sbagliato della stessa lunghezza", () => {
    // Stessa lunghezza di proposito: è il caso che un confronto ingenuo
    // distinguerebbe per tempo di esecuzione.
    const wrong = `${SECRET.slice(0, -1)}x`;
    expect(wrong).toHaveLength(SECRET.length);

    expect(authoriseJob(headersWith(`Bearer ${wrong}`)).ok).toBe(false);
  });

  it("rifiuta un segreto che è un prefisso di quello giusto", () => {
    const result = authoriseJob(headersWith(`Bearer ${SECRET.slice(0, 10)}`));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("atteso rifiuto");
    // Non «misconfigured»: il server è configurato, è chi chiama a sbagliare.
    expect(result.reason).toBe("refused");
  });

  it("rifiuta una richiesta senza alcun segreto", () => {
    expect(authoriseJob(new Headers()).ok).toBe(false);
  });

  it("rifiuta tutto quando il segreto non è configurato sul server", () => {
    /*
     * L'alternativa sarebbe un job che chiunque può innescare. Una porta senza
     * serratura non è più aperta di una con la serratura rotta: è la stessa
     * cosa, ed è per questo che l'assenza di configurazione rifiuta invece di
     * lasciar passare.
     */
    delete process.env["JOB_SECRET"];

    const result = authoriseJob(headersWith(`Bearer ${SECRET}`));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("atteso rifiuto");
    expect(result.reason).toBe("misconfigured");
    expect(result.detail).toBe("name-missing");
  });

  it("tratta un segreto vuoto come assente", () => {
    // `JOB_SECRET=` in un file di ambiente è un errore di battitura, non la
    // scelta di non avere un segreto: accettarlo renderebbe la porta apribile
    // con una stringa vuota.
    process.env["JOB_SECRET"] = "";

    const result = authoriseJob(headersWith("Bearer "));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("atteso rifiuto");
    expect(result.reason).toBe("misconfigured");
  });

  it("distingue «non l'hai creata» da «l'hai creata del tipo sbagliato»", () => {
    /*
     * Il caso vero, incontrato mettendo in linea la lettura schedulata.
     *
     * Su Vercel una variabile di tipo *Secret* raggiunge il processo con il
     * **nome presente e il valore vuoto**; una di tipo *Config* arriva
     * valorizzata. Il sintomo è identico all'assenza — «Job non configurato» —
     * ma la variabile nel pannello **si vede**, quindi chi cerca il problema
     * guarda ovunque tranne che nel tipo.
     *
     * La stessa trappola costò tre giorni con `SECRETS_KEY`. Questa riga esiste
     * perché la seconda volta costi un minuto.
     */
    process.env["JOB_SECRET"] = "";

    const vuota = authoriseJob(headersWith("Bearer x"));
    if (vuota.ok) throw new Error("atteso rifiuto");
    expect(vuota.detail).toBe("value-empty");

    delete process.env["JOB_SECRET"];

    const assente = authoriseJob(headersWith("Bearer x"));
    if (assente.ok) throw new Error("atteso rifiuto");
    expect(assente.detail).toBe("name-missing");
  });

  it("non legge il segreto dall'indirizzo", () => {
    /*
     * Un indirizzo attraversa la cronologia del browser, i log dei proxy e
     * l'intestazione `referer`: un segreto messo lì è un segreto già speso.
     * Il codice non lo legge, e questo test lo dichiara.
     */
    expect(presentedSecret(new Headers())).toBeNull();
  });

  it("ignora uno schema di autorizzazione diverso da Bearer", () => {
    expect(presentedSecret(headersWith(`Basic ${SECRET}`))).toBeNull();
  });
});

describe("giorno UTC di un istante", () => {
  it("è la chiave che rende idempotente un'esecuzione", () => {
    // Due esecuzioni nello stesso giorno devono aggiornare la stessa riga: due
    // punti sullo stesso giorno suggerirebbero una variazione che non c'è
    // stata.
    expect(utcDay(new Date("2026-08-24T06:00:00.000Z"))).toBe("2026-08-24");
    expect(utcDay(new Date("2026-08-24T23:59:59.999Z"))).toBe("2026-08-24");
  });

  it("cambia a mezzanotte UTC, non a mezzanotte locale", () => {
    // Il database conserva tutto in UTC (§7): usare il giorno locale
    // significherebbe che lo stesso istante cade in due giorni diversi a
    // seconda di dove gira il processo.
    expect(utcDay(new Date("2026-08-25T00:00:00.000Z"))).toBe("2026-08-25");
  });
});
