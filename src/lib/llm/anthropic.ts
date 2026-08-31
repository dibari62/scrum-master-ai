import { countTokens, renderRequest, renderUserContent } from "./fake";
import { LlmProviderError, type LlmProviderAdapter, type LlmRequest, type LlmResponse } from "./types";

/**
 * Anthropic (Claude), che parla un dialetto suo.
 *
 * Un file a parte perché il formato differisce in tre punti, e ciascuno
 * costringerebbe l'adattatore condiviso a un ramo condizionale: le istruzioni di
 * sistema stanno in un campo `system` di primo livello invece che in un
 * messaggio, la risposta arriva come lista di blocchi tipizzati invece che come
 * stringa, e i token si chiamano `input_tokens` / `output_tokens`.
 *
 * Tre rami dentro una funzione condivisa avrebbero reso quella funzione più
 * difficile da leggere di due funzioni separate — che è il momento in cui
 * conviene smettere di condividere.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";

/**
 * La versione dell'API, che Anthropic pretende in un'intestazione.
 *
 * Fissata qui e non lasciata al fornitore: senza, ogni cambio di predefinito da
 * parte loro arriverebbe come una risposta di forma diversa in un giorno che non
 * abbiamo scelto noi.
 */
const API_VERSION = "2023-06-01";

/** Il più piccolo della famiglia: chi non sceglie non deve trovarsi il più caro. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";

export type AnthropicOptions = {
  readonly apiKey: string;
  readonly model?: string | null | undefined;
  /** Iniettato per poter verificare l'adattatore senza rete (§9). */
  readonly httpFetch?: typeof fetch;
};

type AnthropicReply = {
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
  readonly stop_reason?: string;
  readonly error?: { readonly message?: string };
};

function classify(status: number, detail: string): LlmProviderError {
  if (status === 401 || status === 403) {
    return new LlmProviderError(
      "provider_not_configured",
      `Anthropic ha rifiutato la chiave di questo progetto (${status}). Va rigenerata e reinserita.`,
      false,
      status,
    );
  }

  if (status === 429) {
    // `rate_limited` e non `provider_unavailable`: il secondo, a valle, manda a
    // controllare il nome del modello. Qui la risposta giusta è aspettare.
    return new LlmProviderError(
      "rate_limited",
      "Anthropic ha risposto che il limite del piano è stato raggiunto. La quota è del progetto, non nostra.",
      true,
      status,
    );
  }

  if (status >= 500) {
    return new LlmProviderError(
      "provider_unavailable",
      `Anthropic non è raggiungibile (${status}).`,
      true,
      status,
    );
  }

  return new LlmProviderError(
    "provider_unavailable",
    `Anthropic ha rifiutato la richiesta (${status}): ${detail}`,
    false,
    status,
  );
}

export function createAnthropicProvider(options: AnthropicOptions): LlmProviderAdapter {
  const httpFetch = options.httpFetch ?? fetch;
  const model = options.model?.trim() || DEFAULT_ANTHROPIC_MODEL;

  return {
    name: "anthropic",

    isConfigured: () => options.apiKey.trim().length > 0,

    async complete(request: LlmRequest): Promise<LlmResponse> {
      const body = {
        model,
        // `system` di primo livello: è la separazione fra istruzioni e dati che
        // §8.1 chiede, e qui il formato la offre esplicitamente.
        system: request.system,
        messages: [{ role: "user", content: renderUserContent(request) }],
        max_tokens: request.maxTokens,
        temperature: 0,
      };

      let response: Response;

      try {
        response = await httpFetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": API_VERSION,
            // In un'intestazione e mai nell'indirizzo.
            "x-api-key": options.apiKey,
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new LlmProviderError(
          "provider_unavailable",
          `Non è stato possibile contattare Anthropic: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }

      const payload = (await response.json().catch(() => ({}))) as AnthropicReply;

      if (!response.ok) {
        throw classify(response.status, payload.error?.message ?? "nessun dettaglio");
      }

      // Blocchi tipizzati: si tiene solo il testo, perché è l'unica cosa di cui
      // abbiamo uso e l'unica che uno schema Zod saprà validare.
      const text = (payload.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");

      if (text.trim() === "") {
        throw new LlmProviderError(
          "invalid_output",
          `Anthropic non ha prodotto testo (motivo: ${payload.stop_reason ?? "sconosciuto"}).`,
          false,
        );
      }

      return {
        text,
        inputTokens: payload.usage?.input_tokens ?? countTokens(renderRequest(request)),
        outputTokens: payload.usage?.output_tokens ?? countTokens(text),
        model,
      };
    },
  };
}
