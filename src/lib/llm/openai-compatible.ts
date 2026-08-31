import type { LlmProvider } from "@/domain";

import { countTokens, renderRequest, renderUserContent } from "./fake";
import { LlmProviderError, type LlmProviderAdapter, type LlmRequest, type LlmResponse } from "./types";

/**
 * Cinque fornitori, un adattatore.
 *
 * **Il fatto che rende possibile questo file.** OpenAI ha pubblicato la forma
 * della propria API — `POST /v1/chat/completions`, un corpo con `messages`, una
 * risposta con `choices` — e gli altri l'hanno adottata. Groq, Mistral,
 * OpenRouter e Ollama rispondono allo stesso corpo di richiesta: cambia
 * l'indirizzo, non il dialetto.
 *
 * Quindi non ci sono cinque adattatori da scrivere e mantenere, ma uno solo
 * parametrizzato sull'indirizzo di base. Aggiungere un sesto fornitore
 * compatibile — DeepSeek, Together, Fireworks, un gateway aziendale — è una riga
 * nella tabella qui sotto.
 *
 * > **Il ponte con l'AS/400, e vale la pena farlo.** È la stessa idea di un
 * > programma che legge un file logico invece del fisico: la forma del record è
 * > dichiarata una volta, e chi la rispetta può essere sostituito senza toccare
 * > il programma. Qui il «file logico» è la forma della richiesta HTTP, e
 * > l'hanno adottata cinque fornitori diversi.
 *
 * Ciò che **non** è condiviso è il prezzo, che sta in `pricing.ts`, e il nome del
 * modello, che ogni fornitore chiama a modo suo.
 */

export type CompatibleProvider = "openai" | "mistral" | "groq" | "openrouter" | "ollama";

type ProviderProfile = {
  readonly baseUrl: string;
  readonly defaultModel: string;
  /**
   * `false` per chi gira in casa.
   *
   * Ollama ascolta su `localhost` e non chiede credenziali: pretenderne una
   * bloccherebbe l'unico fornitore in cui i dati non lasciano l'azienda, che è
   * anche quello con la ragione più forte per essere scelto.
   */
  readonly needsKey: boolean;
  /** Dove si genera la credenziale, per una schermata che accompagna invece di rifiutare. */
  readonly keyPage: string | null;
};

export const COMPATIBLE_PROFILES: Readonly<Record<CompatibleProvider, ProviderProfile>> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    // Il piccolo della famiglia: chi non sceglie non deve ritrovarsi il più caro.
    defaultModel: "gpt-4o-mini",
    needsKey: true,
    keyPage: "platform.openai.com/api-keys",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    needsKey: true,
    keyPage: "console.mistral.ai",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    needsKey: true,
    keyPage: "console.groq.com/keys",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.0-flash-001",
    needsKey: true,
    keyPage: "openrouter.ai/keys",
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    needsKey: false,
    keyPage: null,
  },
};

export type CompatibleOptions = {
  readonly provider: CompatibleProvider;
  readonly apiKey: string | null;
  readonly model?: string | null | undefined;
  /**
   * Sovrascrive l'indirizzo del profilo.
   *
   * Serve a due casi reali e non ipotetici: un Ollama che gira su un'altra
   * macchina, e un gateway aziendale che espone la stessa API dietro un
   * indirizzo interno. Senza, entrambi resterebbero fuori.
   */
  readonly baseUrl?: string | null | undefined;
  /** Iniettato per poter verificare l'adattatore senza rete (§9). */
  readonly httpFetch?: typeof fetch;
};

type ChatReply = {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
    readonly finish_reason?: string;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly error?: { readonly message?: string };
};

/**
 * Da un codice HTTP a qualcosa su cui il gateway può decidere.
 *
 * La distinzione che conta è **riprovabile o no**: un limite di frequenza lo è,
 * una chiave revocata no. Riprovare su un 401 spenderebbe il tentativo di
 * riserva per ottenere lo stesso rifiuto, e ritarderebbe il momento in cui
 * qualcuno legge «la tua chiave è stata rifiutata».
 */
function classify(provider: CompatibleProvider, status: number, detail: string): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError(
      "provider_not_configured",
      `${provider} ha rifiutato la credenziale di questo progetto (${status}). Va rigenerata e reinserita.`,
      false,
    );
  }

  if (status === 402) {
    // Distinto dal 401: la chiave è valida, il credito è finito. Sono due cose
    // diverse da fare, e dirle uguali manderebbe a rigenerare una chiave che va
    // benissimo.
    return new LlmProviderError(
      "provider_not_configured",
      `${provider} riporta che il credito del progetto è esaurito.`,
      false,
    );
  }

  if (status === 429) {
    return new LlmProviderError(
      "provider_unavailable",
      `${provider} ha risposto che il limite del piano è stato raggiunto. La quota è del progetto, non nostra.`,
      true,
    );
  }

  if (status >= 500) {
    return new LlmProviderError(
      "provider_unavailable",
      `${provider} non è raggiungibile (${status}).`,
      true,
    );
  }

  return new LlmProviderError(
    "provider_unavailable",
    `${provider} ha rifiutato la richiesta (${status}): ${detail}`,
    false,
  );
}

export function createCompatibleProvider(options: CompatibleOptions): LlmProviderAdapter {
  const profile = COMPATIBLE_PROFILES[options.provider];

  const httpFetch = options.httpFetch ?? fetch;
  const model = options.model?.trim() || profile.defaultModel;
  const baseUrl = (options.baseUrl?.trim() || profile.baseUrl).replace(/\/+$/, "");

  return {
    name: options.provider,

    isConfigured: () => !profile.needsKey || (options.apiKey ?? "").trim().length > 0,

    /**
     * I modelli che questa credenziale può usare.
     *
     * `GET /models` fa parte del dialetto che tutti e cinque hanno adottato
     * insieme a `/chat/completions`, quindi un'implementazione sola li serve
     * tutti — Ollama compreso, che elenca quelli scaricati sulla macchina.
     */
    async listModels(): Promise<readonly string[]> {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.apiKey) headers["Authorization"] = `Bearer ${options.apiKey}`;

      const response = await httpFetch(`${baseUrl}/models`, { headers });

      if (!response.ok) {
        throw new LlmProviderError(
          "provider_unavailable",
          `${options.provider} non ha voluto elencare i modelli (${response.status}).`,
          false,
        );
      }

      const payload = (await response.json().catch(() => ({}))) as {
        data?: readonly { id?: string }[];
      };

      return (payload.data ?? []).map((entry) => entry.id ?? "").filter((id) => id.length > 0);
    },

    async complete(request: LlmRequest): Promise<LlmResponse> {
      /*
       * Il messaggio dell'utente lo compone `renderUserContent`, che mette i
       * delimitatori attorno al contenuto non fidato (§8.1).
       *
       * Le istruzioni di sistema vanno nel messaggio `system` e **non** vengono
       * ripetute nel messaggio dell'utente: ripetere una direttiva accanto a
       * testo di terzi è una delle forme che rendono un'iniezione più probabile,
       * non meno.
       */
      const body = {
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: renderUserContent(request) },
        ],
        max_tokens: request.maxTokens,
        // Zero: le nostre uscite sono vincolate a uno schema Zod (ADR-0004), la
        // creatività produce solo tentativi rifiutati dalla validazione.
        temperature: 0,
      };

      const headers: Record<string, string> = { "Content-Type": "application/json" };

      // In un'intestazione e mai nell'indirizzo: un segreto in una query string
      // finisce nei log di ogni proxy attraversato.
      if (options.apiKey) headers["Authorization"] = `Bearer ${options.apiKey}`;

      let response: Response;

      try {
        response = await httpFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        throw new LlmProviderError(
          "provider_unavailable",
          options.provider === "ollama"
            ? `Non è stato possibile contattare Ollama su ${baseUrl}. È in esecuzione? (${message})`
            : `Non è stato possibile contattare ${options.provider}: ${message}`,
          true,
        );
      }

      const payload = (await response.json().catch(() => ({}))) as ChatReply;

      if (!response.ok) {
        throw classify(options.provider, response.status, payload.error?.message ?? "nessun dettaglio");
      }

      const text = payload.choices?.[0]?.message?.content ?? "";

      if (text.trim() === "") {
        /*
         * Una risposta vuota non è una risposta.
         *
         * Succede sul tetto dei token o su un filtro. Restituirla come testo la
         * farebbe rifiutare dalla validazione dello **schema**, e chi legge il
         * diario cercherebbe il difetto nel posto sbagliato.
         */
        const reason = payload.choices?.[0]?.finish_reason ?? "sconosciuto";
        throw new LlmProviderError(
          "invalid_output",
          `${options.provider} non ha prodotto testo (motivo: ${reason}).`,
          false,
        );
      }

      /*
       * I conteggi del fornitore quando ci sono, i nostri quando mancano.
       *
       * Sono i numeri da cui si stima il costo, e quelli del fornitore sono gli
       * unici che corrispondono a ciò che verrà fatturato al cliente. Ollama non
       * li manda sempre, ed è giusto così: lì non si fattura nulla.
       */
      return {
        text,
        inputTokens: payload.usage?.prompt_tokens ?? countTokens(renderRequest(request)),
        outputTokens: payload.usage?.completion_tokens ?? countTokens(text),
        model,
      };
    },
  };
}

/** Whether a provider speaks the shared dialect, so a caller can pick an adapter. */
export function isCompatibleProvider(provider: LlmProvider): provider is CompatibleProvider {
  return provider in COMPATIBLE_PROFILES;
}
