import { timingSafeEqual } from "node:crypto";

/**
 * Who is allowed to trigger a scheduled job.
 *
 * **A shared secret, not a signature, and the trade-off is declared.** Upstash
 * signs its requests, and verifying that signature would prove the call came
 * from the scheduler rather than from anyone holding a string. It also means a
 * JWS implementation and a dependency, which needs an ADR (§3). A bearer secret
 * over HTTPS is a legitimate mechanism, and it is the one `.env.example` has
 * anticipated since T0. The stronger check is worth adding the day this job can
 * do something irreversible; today it recomputes numbers and writes one row per
 * sprint per day.
 *
 * **The comparison is constant-time.** A plain `===` returns as soon as two
 * bytes differ, which lets an attacker recover a secret one character at a time
 * by measuring how long the refusal took. The defence costs a function call and
 * removes an entire class of attack, so there is no version of this worth
 * writing the fast way.
 *
 * Nothing here ever reports what the expected value was, how long it is, or how
 * far a wrong guess got.
 */

export type JobAuthorisation =
  | { readonly ok: true }
  /** `misconfigured` is the server's fault, `refused` is the caller's. */
  | {
      readonly ok: false;
      readonly reason: "misconfigured" | "refused";
      /**
       * Come manca il segreto, quando manca.
       *
       * `name-missing`: la variabile non è mai stata creata.
       * `value-empty`: il nome arriva ma il contenuto no — su Vercel è il tipo
       * *Secret*, che va ricreato come *Config*.
       *
       * Non compare mai in una risposta HTTP: serve al registro del server e a
       * chi amministra, che sono gli unici a poterci fare qualcosa.
       */
      readonly detail?: "name-missing" | "value-empty";
    };

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * `timingSafeEqual` throws when the buffers differ in length — which would
 * itself reveal the length of the expected secret — so the lengths are checked
 * first and a mismatch is reported as an ordinary refusal.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Reads the presented secret from the request.
 *
 * Two accepted forms, and neither is a query parameter: an address travels
 * through browser history, proxy logs and referrer headers, and a secret in one
 * is a secret already spent.
 */
export function presentedSecret(headers: Headers): string | null {
  const bearer = headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice("Bearer ".length).trim();

  return headers.get("x-job-secret");
}

export function authoriseJob(headers: Headers): JobAuthorisation {
  const expected = process.env["JOB_SECRET"];

  // Refusing everything is the right answer when the server has no secret to
  // check against: the alternative is a job anyone can trigger.
  if (!expected || expected.length === 0) {
    /*
     * Due modi di non esserci, e distinguerli fa risparmiare ore.
     *
     * **Il caso vero.** Su Vercel una variabile di tipo *Secret* raggiunge il
     * processo con il **nome presente e il valore vuoto**; una di tipo *Config*
     * arriva valorizzata. La descrizione di «Secret» nomina esattamente questo
     * caso d'uso — «passwords, API keys, and tokens» — quindi è la scelta che
     * chiunque farebbe, ed è quella sbagliata.
     *
     * Costò tre giorni con `SECRETS_KEY` (ripartire-da-zero §5.quinquies). Qui
     * la distinzione è scritta nel codice fin dal principio, perché il sintomo
     * — «Job non configurato» su una variabile che nel pannello si vede — è
     * identico e manda a cercare nello stesso posto sbagliato.
     */
    return {
      ok: false,
      reason: "misconfigured",
      detail: expected === undefined ? "name-missing" : "value-empty",
    };
  }

  const presented = presentedSecret(headers);
  if (!presented) return { ok: false, reason: "refused" };

  return constantTimeEquals(presented, expected)
    ? { ok: true }
    : { ok: false, reason: "refused" };
}
