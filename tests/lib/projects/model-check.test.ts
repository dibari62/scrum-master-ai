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

  it("distingue «chiave rifiutata» da «richiesta rifiutata»", async () => {
    /*
     * Sono i due casi di gran lunga più frequenti, e le azioni da fare sono
     * opposte: nel primo si rigenera una chiave, nel secondo la chiave va
     * benissimo e il sospetto è il nome del modello.
     *
     * Gli adattatori li separano già — un 401 diventa `provider_not_configured`,
     * un 400 resta `provider_unavailable` — e la prima stesura di questo modulo
     * li rimescolava, nominando la chiave in entrambi. Chi ne aveva appena
     * incollata una buona veniva mandato a rigenerarla per niente.
     */
    const chiave = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_not_configured", message: "x" }),
      provider: "gemini",
    });

    const richiesta = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_unavailable", message: "x" }),
      provider: "gemini",
    });

    if (chiave.kind !== "failed" || richiesta.kind !== "failed") {
      throw new Error("attesi due fallimenti");
    }

    expect(chiave.message).toContain("rifiutata");
    expect(chiave.message).toContain("Rigenerala");

    expect(richiesta.message).toContain("ha riconosciuto la chiave");
    expect(richiesta.message).toContain("Modello");
    // La prova che discrimina: qui non si deve suggerire di toccare la chiave.
    expect(richiesta.message).not.toContain("Rigenerala");
  });

  it("chiede quali modelli esistono quando è la richiesta a essere stata rifiutata", async () => {
    /*
     * Lo stesso rimedio della diagnosi di una lettura Jira a vuoto: quando una
     * configurazione non funziona, la domanda giusta si fa **al servizio**, non
     * a chi la sta subendo. «Controlla il nome del modello» senza dire quali
     * nomi esistano lascia esattamente dove si era.
     */
    const outcome = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_unavailable", message: "x" }),
      provider: "gemini",
      listModels: async () => ["gemini-2.5-flash", "gemini-2.5-pro"],
    });

    if (outcome.kind !== "failed") throw new Error("atteso fallimento");
    expect(outcome.availableModels).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });

  it("non spende una chiamata in più quando l'elenco non cambierebbe la risposta", async () => {
    /*
     * Su una chiave rifiutata la sonda fallirebbe per la stessa ragione, e su
     * una quota esaurita confermerebbe ciò che già si sa. In entrambi i casi
     * sarebbe una chiamata al fornitore per niente.
     */
    let asked = 0;
    const listModels = async () => {
      asked += 1;
      return ["gemini-2.5-flash"];
    };

    await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_not_configured", message: "x" }),
      provider: "gemini",
      listModels,
    });

    await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "rate_limited", message: "x" }),
      provider: "gemini",
      listModels,
    });

    expect(asked).toBe(0);
  });

  it("resta senza elenco, invece di fallire, se la sonda non risponde", async () => {
    // La prova ha già il suo esito: un elenco è un di più, e trasformare la sua
    // assenza in un errore direbbe a chi legge che è andata peggio di com'è andata.
    const outcome = await checkModel({
      gateway: gatewayThat({ ...FAILURE, failureCause: "provider_unavailable", message: "x" }),
      provider: "gemini",
      listModels: async () => {
        throw new Error("403");
      },
    });

    if (outcome.kind !== "failed") throw new Error("atteso fallimento");
    expect(outcome.availableModels).toEqual([]);
    expect(outcome.message).toContain("Modello");
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
    expect(request.maxTokens).toBeLessThanOrEqual(400);
  });

  it("chiede un tetto di token più alto di quanto la richiesta stessa costi", async () => {
    /*
     * Il gateway stima i token **prima** di chiamare e rifiuta se la stima
     * supera `maxTokens`. Un tetto troppo stretto farebbe fallire la prova per
     * «budget superato» senza mai telefonare: il messaggio più fuorviante
     * possibile per chi sta verificando una chiave, perché non parla né della
     * chiave né del fornitore.
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
    const { estimateRequestTokens } = await import("@/lib/llm");

    expect(estimateRequestTokens(request)).toBeLessThan(request.maxTokens);
  });
});
