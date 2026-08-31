import { countTokens, renderRequest, renderUserContent } from "./fake";
import { LlmProviderError, type LlmProviderAdapter, type LlmRequest, type LlmResponse } from "./types";

/**
 * Google Gemini, chiamato via REST.
 *
 * **Senza SDK, e non per pigrizia.** La tabella dello stack nomina il Vercel AI
 * SDK, e resta la scelta giusta il giorno in cui i fornitori saranno tre e le
 * loro differenze cominceranno a pesare. Oggi il fornitore è uno e la chiamata è
 * un `POST` con un corpo JSON: sessanta righe di codice nostro sono più leggibili
 * di un pacchetto in più, e §3 dice esattamente questo — «in caso di dubbio, usa
 * la libreria standard o scrivi 20 righe tue».
 *
 * C'è un secondo motivo, meno ovvio e più decisivo. Con ADR-0010 **la chiave
 * arriva per progetto**, non dall'ambiente: ogni adattatore viene costruito con
 * la credenziale di *quel* progetto, e vive quanto una chiamata. Un SDK
 * configurato una volta all'avvio avrebbe reso quel passaggio innaturale, e la
 * strada più corta sarebbe stata una variabile globale con la chiave di
 * qualcuno dentro.
 *
 * §8.1 resta intatto: il testo di terzi arriva delimitato da `renderUserContent`,
 * la stessa funzione che usano gli altri adattatori. Le istruzioni di sistema
 * vanno nel campo dedicato e non vengono ripetute accanto ai dati.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Il modello predefinito quando il progetto non ne dichiara uno.
 *
 * Il più piccolo della famiglia, e volutamente: è quello con il piano gratuito
 * più generoso, e chi non ha espresso una preferenza non dovrebbe scoprire di
 * aver scelto il più caro.
 *
 * **Perché non è più `gemini-2.0-flash`.** Quel nome ha smesso di comparire fra
 * i modelli che Google offre, e una chiave nuova con la configurazione
 * predefinita otteneva un rifiuto — verificato su un'istanza vera. È il modo in
 * cui invecchia un valore scritto una volta: senza rumore, e nel punto che
 * riguarda esattamente chi non ha scelto niente.
 *
 * **Un nome con la versione, non `gemini-flash-latest`.** L'alias resiste al
 * tempo ma cambia comportamento senza preavviso, e le nostre uscite sono
 * vincolate a uno schema (ADR-0004): un modello che cambia da solo trasforma
 * una valutazione ripetibile in una che non lo è più. Meglio un nome che
 * invecchia visibilmente — e ora c'è un pulsante che lo dice.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export type GoogleProviderOptions = {
  readonly apiKey: string;
  readonly model?: string | null | undefined;
  /** Iniettato per poter verificare l'adattatore senza rete (§6). */
  readonly httpFetch?: typeof fetch;
};

/**
 * Ciò che leggiamo della risposta, e nulla di più.
 *
 * Descritta a mano invece che con uno schema Zod perché **non è un dato di
 * dominio**: è il formato di un fornitore, e vive dentro questo file come i tipi
 * Jira vivono dentro il loro connettore. Ciò che ne esce è `LlmResponse`, che è
 * nostro.
 */
type GeminiReply = {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
    readonly finishReason?: string;
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
  readonly error?: { readonly message?: string; readonly status?: string };
};

/**
 * Come si traduce un codice HTTP in qualcosa su cui il gateway può decidere.
 *
 * La distinzione che conta è **riprovabile o no**: un limite di frequenza lo è,
 * una chiave revocata no. Un gateway che riprovasse su un 401 spenderebbe il
 * tentativo di riserva per ottenere lo stesso rifiuto, e ritarderebbe il momento
 * in cui qualcuno legge «la tua chiave è stata rifiutata».
 */
function classifyStatus(status: number, message: string): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError(
      "provider_not_configured",
      `Gemini ha rifiutato la chiave di questo progetto (${status}). Va rigenerata e reinserita.`,
      false,
      status,
    );
  }

  if (status === 429) {
    /*
     * `rate_limited`, non `provider_unavailable`.
     *
     * **La classificazione contava più di quanto sembrasse.** A valle,
     * `provider_unavailable` significa «il fornitore ha riconosciuto la chiave e
     * ha rifiutato la richiesta», e il consiglio che ne segue è di controllare
     * il nome del modello. Con un 429 quel consiglio manda a cambiare una
     * configurazione che funziona: la risposta giusta è aspettare.
     *
     * L'enum aveva già il valore adatto e nessuno lo usava.
     */
    return new LlmProviderError(
      "rate_limited",
      "Gemini ha risposto che il limite del piano è stato raggiunto. La quota è del progetto, non nostra.",
      true,
      status,
    );
  }

  if (status >= 500) {
    return new LlmProviderError(
      "provider_unavailable",
      `Gemini non è raggiungibile (${status}).`,
      true,
      status,
    );
  }

  // 400 e simili: la richiesta è sbagliata, e riproporla identica al fornitore
  // di riserva otterrebbe lo stesso rifiuto.
  return new LlmProviderError(
    "provider_unavailable",
    `Gemini ha rifiutato la richiesta (${status}): ${message}`,
    false,
    status,
  );
}

export function createGoogleProvider(options: GoogleProviderOptions): LlmProviderAdapter {
  const httpFetch = options.httpFetch ?? fetch;
  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;

  return {
    name: "gemini",

    // Una chiave vuota è una chiave assente: il gateway salta il fornitore
    // invece di provarlo e riportarlo indisponibile.
    isConfigured: () => options.apiKey.trim().length > 0,

    /**
     * I modelli che questa chiave può usare, secondo Google.
     *
     * Solo quelli che sanno generare testo: l'elenco comprende anche modelli di
     * sola trasformazione in vettori, che offerti come alternativa manderebbero
     * a incollare un nome che fallirebbe di nuovo.
     */
    async listModels(): Promise<readonly string[]> {
      const response = await httpFetch(ENDPOINT, {
        headers: { "x-goog-api-key": options.apiKey },
      });

      if (!response.ok) throw classifyStatus(response.status, "elenco modelli non disponibile");

      const payload = (await response.json().catch(() => ({}))) as {
        models?: readonly {
          name?: string;
          supportedGenerationMethods?: readonly string[];
        }[];
      };

      return (payload.models ?? [])
        .filter((entry) => (entry.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((entry) => (entry.name ?? "").replace(/^models\//, ""))
        .filter((name) => name.length > 0);
    },

    async complete(request: LlmRequest): Promise<LlmResponse> {
      /*
       * I delimitatori attorno al contenuto non fidato li mette
       * `renderUserContent` (§8.1), la stessa funzione degli altri adattatori.
       *
       * Le istruzioni di sistema vanno in `systemInstruction` e **non** vengono
       * ripetute accanto ai dati: ripetere una direttiva vicino a testo di terzi
       * è una delle forme che rendono un'iniezione più probabile, non meno.
       */
      const body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: renderUserContent(request) }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          /*
           * Zero, e non il valore predefinito del fornitore.
           *
           * Le nostre uscite sono vincolate a uno schema Zod (ADR-0004): la
           * creatività non serve a nulla e produce solo più tentativi rifiutati
           * dalla validazione. Ed è anche ciò che rende un'eval ripetibile.
           */
          temperature: 0,
        },
      };

      let response: Response;

      try {
        response = await httpFetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // In un'intestazione e mai nell'indirizzo: una chiave in una query
            // string finisce nei log di ogni proxy attraversato.
            "x-goog-api-key": options.apiKey,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new LlmProviderError(
          "provider_unavailable",
          `Non è stato possibile contattare Gemini: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }

      const payload = (await response.json().catch(() => ({}))) as GeminiReply;

      if (!response.ok) {
        throw classifyStatus(response.status, payload.error?.message ?? "nessun dettaglio");
      }

      const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");

      if (text.trim() === "") {
        /*
         * Una risposta vuota non è una risposta.
         *
         * Succede quando il modello si ferma sul tetto dei token o su un filtro
         * di sicurezza. Restituirla come testo la farebbe arrivare alla
         * validazione, che la rifiuterebbe con un errore sullo *schema* — e chi
         * legge il diario cercherebbe il difetto nel posto sbagliato.
         */
        const reason = payload.candidates?.[0]?.finishReason ?? "sconosciuta";
        throw new LlmProviderError(
          "invalid_output",
          `Gemini non ha prodotto testo (motivo: ${reason}).`,
          false,
        );
      }

      /*
       * I conteggi del fornitore quando ci sono, i nostri quando mancano.
       *
       * Sono i numeri che finiscono nel registro delle esecuzioni e da cui si
       * stima il costo: quelli del fornitore sono gli unici che corrispondono a
       * ciò che verrà fatturato. In loro assenza si stima, e si stima con la
       * stessa funzione del fornitore finto, così i due sono confrontabili.
       */
      return {
        text,
        inputTokens: payload.usageMetadata?.promptTokenCount ?? countTokens(renderRequest(request)),
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? countTokens(text),
        model,
      };
    },
  };
}
