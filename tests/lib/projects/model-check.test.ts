import { describe, expect, it } from "vitest";

import type { Gateway } from "@/lib/llm";
import { checkModel } from "@/lib/projects/model-check";

/**
 * La prova di connessione al modello, senza modello.
 *
 * §9 vieta chiamate a un fornitore nei test, e la parte che telefona è già
 * provata altrove. Qui si verifica l'unica cosa che questo modulo decide: come
 * si legge un esito, e che cosa si dice a chi ha appena incollato una chiave.
 *
 * Il criterio di ogni asserzione è lo stesso: il messaggio deve nominare il
 * **gesto successivo**. «Errore del fornitore» è vero e inservibile.
 */

function gatewayThat(outcome: Awaited<ReturnType<Gateway["complete"]>>): Gateway {
  return { complete: async () => outcome };
}

const FAILURE = {
  ok: false as const,
  provider: "gemini" as const,
  model: "gemini-2.0-flash",
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  durationMs: 12,
};

const NEVER_CALLED: Gateway = {
  complete: async () => {
    throw new Error("il fornitore non doveva essere chiamato");
  },
};

describe("prova di connessione al modello", () => {
  it("non chiama nessuno quando il fornitore è quello dimostrativo", async () => {
    /*
     * `fake` risponde sempre: un esito «riuscito» direbbe soltanto che il
     * codice gira, e sarebbe un semaforo verde che non significa niente.
     *
     * Il gateway qui esplode se chiamato, perché l'asserzione che conta è che
     * **non** venga chiamato.
     */
    const outcome = await checkModel({ gateway: NEVER_CALLED, provider: "fake" });

    expect(outcome.kind).toBe("fake");
  });

  it("riporta chi ha risposto, con quale modello, e cosa ha detto", async () => {
    // La frase tornata indietro è l'unica prova che nessuno può aver inventato
    // da questa parte: «ha funzionato» è una nostra affermazione.
    const outcome = await checkModel({
      gateway: gatewayThat({
        ok: true,
        text: "  pronto  ",
        provider: "gemini",
        model: "gemini-2.0-flash",
        inputTokens: 20,
        outputTokens: 2,
        estimatedCostUsd: 0.000_01,
        durationMs: 640,
      }),
      provider: "gemini",
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("atteso esito riuscito");

    expect(outcome.provider).toBe("gemini");
    expect(outcome.model).toBe("gemini-2.0-flash");
    expect(outcome.reply).toBe("pronto");
    expect(outcome.durationMs).toBe(640);
  });

  it("non lascia che una risposta lunghissima invada la schermata", async () => {
    // Un modello che ignora «rispondi con una sola parola» esiste, e la sua
    // risposta non deve diventare il contenuto principale della pagina.
    const outcome = await checkModel({
      gateway: gatewayThat({
        ok: true,
        text: "a".repeat(5000),
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 20,
        outputTokens: 900,
        estimatedCostUsd: 0.001,
        durationMs: 900,
      }),
      provider: "openai",
    });

    if (outcome.kind !== "ok") throw new Error("atteso esito riuscito");
    expect(outcome.reply.length).toBeLessThanOrEqual(200);
  });

  it("distingue «manca la chiave» da «la chiave è stata rifiutata»", async () => {
    /*
     * Sono i due casi di gran lunga più frequenti, e le azioni da fare sono
     * diverse: nel primo si inserisce una chiave, nel secondo se ne controlla
     * una che c'è già — o il nome del modello, che sbaglia altrettanto spesso.
     */
    const assente = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_not_configured", message: "x" }),
      provider: "gemini",
    });

    const rifiutata = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_unavailable", message: "x" }),
      provider: "gemini",
    });

    if (assente.kind !== "failed" || rifiutata.kind !== "failed") {
      throw new Error("attesi due fallimenti");
    }

    expect(assente.message).toContain("Manca la chiave");
    expect(rifiutata.message).toContain("non valida");
    expect(rifiutata.message).toContain("modello");
  });

  it("dice che la chiave funziona quando il problema è la quota", async () => {
    // Il caso in cui la risposta giusta è «non toccare niente». Suggerire di
    // ricontrollare la chiave manderebbe a cercare un guasto che non c'è.
    const outcome = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "rate_limited", message: "x" }),
      provider: "gemini",
    });

    if (outcome.kind !== "failed") throw new Error("atteso fallimento");
    expect(outcome.message).toContain("La chiave funziona");
  });

  it("non riporta mai il messaggio del fornitore", async () => {
    /*
     * §8.3. Il messaggio di un errore HTTP può contenere frammenti della
     * richiesta e, con certi fornitori, la chiave rimandata indietro nel corpo
     * dell'errore. Chi amministra lo trova nel registro del server.
     */
    const outcome = await checkModel({
      gateway: gatewayThat({
        ...FAILURE,
        failureCause: "provider_unavailable",
        message: "401 API key AIzaSyTOP-SECRET-VALUE non valida",
      }),
      provider: "gemini",
    });

    if (outcome.kind !== "failed") throw new Error("atteso fallimento");
    expect(outcome.message).not.toContain("AIzaSy");
    expect(outcome.message).not.toContain("SECRET");
  });

  it("manda una richiesta minima, senza alcun dato del progetto", async () => {
    /*
     * §8.1 e §9 insieme. Non c'è testo ingerito nella richiesta, quindi non c'è
     * niente che un contenuto scritto da terzi possa influenzare; e il budget
     * resta piccolo, perché una verifica che costasse quanto un rapporto
     * scoraggerebbe dal farla.
     */
    let seen: Parameters<Gateway["complete"]>[0] | null = null;

    await checkModel({
      gateway: {
        complete: async (request) => {
          seen = request;
          return {
            ok: true,
            text: "pronto",
            provider: "gemini",
            model: "m",
            inputTokens: 10,
            outputTokens: 1,
            estimatedCostUsd: 0,
            durationMs: 1,
          };
        },
      },
      provider: "gemini",
    });

    const request = seen as unknown as Parameters<Gateway["complete"]>[0];

    expect(request.untrustedData).toBeUndefined();
    expect(request.maxTokens).toBeLessThanOrEqual(100);
  });
});
