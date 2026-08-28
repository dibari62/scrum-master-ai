import {
  llmProviderSchema,
  type LlmProvider,
  type SkillRunFailureCause,
} from "@/domain";

import { countTokens, createFakeProvider, renderRequest } from "./fake";
import { createAnthropicProvider } from "./anthropic";
import { createGoogleProvider } from "./google";
import { createCompatibleProvider, isCompatibleProvider } from "./openai-compatible";
import { estimateCostUsd } from "./pricing";
import {
  LlmProviderError,
  type LlmProviderAdapter,
  type LlmRequest,
  type LlmResponse,
} from "./types";

/**
 * The only way to reach a model.
 *
 * ADR-0004 puts provider selection, budget enforcement, fallback and cost
 * measurement here so that a skill contains none of it. A skill asks a
 * question; what it costs, who answered and what happens when nobody does are
 * decisions of this file.
 *
 * Nothing here throws at the caller. Every outcome — including every failure —
 * comes back as a result carrying the numbers a `SkillRun` needs, because the
 * register must record a run that failed just as faithfully as one that
 * worked. A failure that arrives as an exception is a failure nobody writes
 * down.
 */

export type GatewayOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      readonly provider: LlmProvider;
      readonly model: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly estimatedCostUsd: number;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly failureCause: SkillRunFailureCause;
      readonly message: string;
      /** `null` when no provider was ever contacted: the absence is the fact. */
      readonly provider: LlmProvider | null;
      readonly model: string | null;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly estimatedCostUsd: number;
      readonly durationMs: number;
    };

/**
 * The slice of the environment this module reads.
 *
 * Narrower than `NodeJS.ProcessEnv` deliberately. That type requires
 * `NODE_ENV`, which the gateway neither reads nor cares about, and demanding it
 * made the function awkward to call with a two-key object in a test — a sign
 * the signature was asking for more than it needed. `process.env` satisfies
 * this, so nothing is lost at the call site.
 */
export type EnvironmentSlice = Readonly<Record<string, string | undefined>>;

export type GatewayOptions = {
  /**
   * Adapters in order of preference. The first configured one answers; the next
   * is the backup.
   *
   * Injected rather than built inside, so the fallback can be exercised with
   * doubles instead of by throttling a real vendor.
   */
  readonly providers?: readonly LlmProviderAdapter[] | undefined;
  /** Injectable clock: a duration measured from the wall clock is not testable. */
  readonly now?: (() => number) | undefined;

  /**
   * The project's own credentials (ADR-0010).
   *
   * **There is no alternative source, and that is the point.** The application
   * has no model of its own: every run belongs to a project, and a project
   * brings its own key. A gateway built without one would serve one company's
   * report on another company's quota — and no test would notice, because the
   * text produced would be perfectly correct.
   */
  readonly credentials?: ProjectCredentials | undefined;
};

export type Gateway = {
  readonly complete: (request: LlmRequest) => Promise<GatewayOutcome>;
};

/**
 * Which provider the environment asks for — **for `npm run eval` only**.
 *
 * The portal never calls this. An evaluation runs from a command line, outside
 * any request, and has no project to take a key from: it is the one caller left
 * that legitimately reads the environment.
 *
 * An unrecognised value falls back to `fake` rather than throwing. The
 * alternative — refusing to start — turns a typo into a dead run, whereas this
 * turns it into a run that visibly did not reach a vendor. Both are wrong; only
 * one of them can be diagnosed from the register.
 */
export function selectedProvider(env: EnvironmentSlice = process.env): LlmProvider {
  const parsed = llmProviderSchema.safeParse(env["LLM_PROVIDER"]);
  return parsed.success ? parsed.data : "fake";
}

/**
 * The credential each provider reads **from the environment**, for the eval
 * runner.
 *
 * One per provider, never a shared one: ADR-0005 is explicit that *«una riserva
 * che richiede di riscrivere a mano la credenziale non è una riserva»*.
 *
 * These names have nothing to do with the portal. A project's key is typed into
 * its settings and sealed in the database (ADR-0010); no environment variable
 * configures a project's model, and setting one would have no effect.
 */
const API_KEY_VARIABLE: Readonly<Record<LlmProvider, string | null>> = {
  fake: null,
  // Gira in casa e non chiede credenziali: pretenderne una bloccherebbe l'unico
  // fornitore in cui i dati non lasciano l'azienda.
  ollama: null,
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function apiKeyVariableFor(provider: LlmProvider): string | null {
  return API_KEY_VARIABLE[provider];
}

/**
 * A provider declared by ADR-0005 but not yet wired to its SDK.
 *
 * It reports itself unconfigured, so the gateway skips it and the run ends with
 * `provider_not_configured` — the same outcome as a missing key, which is what
 * it honestly is from a caller's point of view.
 *
 * A stub that pretended to work, or one that silently answered with the fake
 * provider's text, would be far worse: a demonstration would appear to use
 * Gemini while producing invented output.
 */
function createUnimplementedProvider(name: LlmProvider): LlmProviderAdapter {
  return {
    name,
    isConfigured: () => false,
    complete: () =>
      Promise.reject(
        new LlmProviderError(
          "provider_not_configured",
          `Il fornitore ${name} non è ancora collegato al proprio SDK.`,
          false,
        ),
      ),
  };
}

/**
 * The credentials of a **project**, when it brings its own (ADR-0010).
 *
 * Passed in rather than read from the environment, and the direction matters:
 * the environment holds *our* key for local development, while this holds *a
 * customer's*. Confusing the two would mean one company's report being written
 * on another company's quota.
 */
export type ProjectCredentials = {
  readonly provider: LlmProvider;
  /** `null` for `fake` and for a local model, which ask for no credential. */
  readonly apiKey: string | null;
  readonly model?: string | null | undefined;
  /** Overrides the vendor's address: a local Ollama, or a company gateway. */
  readonly baseUrl?: string | null | undefined;
};

/**
 * Builds the adapter a provider needs.
 *
 * One place, so the knowledge of «who speaks which dialect» is not spread across
 * the two call sites that need it. Five of the eight share an adapter — see
 * `openai-compatible.ts` for why that is possible at all.
 */
function adapterFor(
  provider: LlmProvider,
  apiKey: string | null,
  model: string | null | undefined,
  baseUrl: string | null | undefined,
): LlmProviderAdapter {
  if (provider === "fake") return createFakeProvider();
  if (provider === "gemini") return createGoogleProvider({ apiKey: apiKey ?? "", model });
  if (provider === "anthropic") return createAnthropicProvider({ apiKey: apiKey ?? "", model });

  if (isCompatibleProvider(provider)) {
    return createCompatibleProvider({ provider, apiKey, model, baseUrl });
  }

  return createUnimplementedProvider(provider);
}

/**
 * The chain the gateway will try for a **project**.
 *
 * One adapter, never two. **Con le credenziali di un progetto non c'è riserva,
 * ed è voluto.** La riserva di ADR-0005 esisteva perché le chiavi erano nostre
 * e le avevamo entrambe. La chiave di un cliente è una sola: dirottare il suo
 * lavoro su un fornitore che non ha scelto significherebbe spendere una quota
 * che non ci ha dato, o fallire con un messaggio che parla di un servizio di
 * cui non sa nulla.
 */
export function providersFor(credentials: ProjectCredentials): readonly LlmProviderAdapter[] {
  return [
    adapterFor(credentials.provider, credentials.apiKey, credentials.model, credentials.baseUrl),
  ];
}

/**
 * The chain built from environment variables — **for `npm run eval` only**.
 *
 * **Perché esiste una funzione a sé invece di un ripiego dentro `createGateway`.**
 * Finché il ripiego era implicito, chiunque scrivesse `createGateway()` senza
 * argomenti otteneva «il modello dell'applicazione», che dopo ADR-0010 non
 * esiste più: ogni esecuzione appartiene a un progetto e usa la chiave del suo
 * cliente. Un gateway costruito senza credenziali servirebbe il rapporto di
 * un'azienda con la chiave di un'altra, e **nessun test se ne accorgerebbe**,
 * perché il testo prodotto sarebbe corretto.
 *
 * Adesso quel gateway va chiesto per nome, e il nome dice da dove prende la
 * chiave. Il portale non lo chiama mai.
 *
 * `fake` non si mescola mai con i fornitori veri: una valutazione che degradasse
 * silenziosamente in testo inventato sarebbe indistinguibile da una riuscita.
 */
export function environmentProviders(
  env: EnvironmentSlice = process.env,
): readonly LlmProviderAdapter[] {
  const selected = selectedProvider(env);
  if (selected === "fake") return [createFakeProvider()];

  const variable = apiKeyVariableFor(selected);

  return [
    adapterFor(
      selected,
      variable === null ? null : (env[variable] ?? null),
      env["LLM_MODEL"] ?? null,
      env["LLM_BASE_URL"] ?? null,
    ),
  ];
}

/** Tokens the request will cost before anything is sent. */
export function estimateRequestTokens(request: LlmRequest): number {
  return countTokens(renderRequest(request));
}

function classify(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  return new LlmProviderError("provider_unavailable", message, true);
}

/**
 * Builds a gateway from a project's credentials, or from adapters given by name.
 *
 * **Non esiste più un ripiego sull'ambiente**, e la sua assenza è la funzione
 * di questa firma: dopo ADR-0010 «il modello dell'applicazione» non è una cosa
 * che esiste, e finché `createGateway()` senza argomenti restituiva qualcosa,
 * era una cosa che si poteva costruire per distrazione. Chi vuole leggere
 * l'ambiente lo chiede per nome con `environmentProviders()`, e oggi lo fa
 * soltanto il runner delle valutazioni.
 *
 * Senza né credenziali né adattatori si ottiene il fornitore fittizio, che è
 * l'unico predefinito difendibile: non chiama nessuno, non spende nulla, e
 * dichiara di essere sé stesso nel risultato invece di somigliare a un modello
 * vero.
 */
export function createGateway(options: GatewayOptions = {}): Gateway {
  const now = options.now ?? (() => Date.now());
  const providers =
    options.providers ??
    (options.credentials ? providersFor(options.credentials) : [createFakeProvider()]);

  /** Se la chiave doveva arrivare da un progetto: cambia solo cosa si dice a chi legge. */
  const fromProject = options.credentials !== undefined;

  return {
    async complete(request: LlmRequest): Promise<GatewayOutcome> {
      const startedAt = now();
      const elapsed = (): number => Math.max(0, now() - startedAt);

      const refused = (
        failureCause: SkillRunFailureCause,
        message: string,
        provider: LlmProvider | null = null,
      ): GatewayOutcome => ({
        ok: false,
        failureCause,
        message,
        provider,
        model: null,
        // Nothing was sent, so nothing was spent. Recording zero here is not a
        // default: it is the measurement (criterio 20).
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        durationMs: elapsed(),
      });

      /*
       * The budget is checked before the call, not after.
       *
       * Checking afterwards would mean paying for the very request the budget
       * existed to prevent, and then reporting that it was over budget.
       */
      const estimated = estimateRequestTokens(request);
      if (estimated > request.maxTokens) {
        return refused(
          "budget_exceeded",
          `La richiesta richiede circa ${estimated} token, oltre il limite di ${request.maxTokens}.`,
        );
      }

      const usable = providers.filter((provider) => provider.isConfigured());

      if (usable.length === 0) {
        /*
         * Il messaggio dipende da **dove** doveva arrivare la chiave, e non è
         * un dettaglio di forma.
         *
         * Nominare `GEMINI_API_KEY` a chi usa il portale lo manda a cercare una
         * variabile d'ambiente che non controlla e che non avrebbe alcun
         * effetto: dopo ADR-0010 la sua chiave si incolla nelle impostazioni del
         * progetto. Era il messaggio giusto quando il modello era nostro, ed è
         * diventato una direzione sbagliata senza che una riga cambiasse.
         *
         * Il nome della variabile resta per il runner delle valutazioni, che
         * l'ambiente lo legge davvero. In nessuno dei due casi compare un
         * valore: un messaggio è un posto da cui un segreto esce verso registri
         * e schermate (§8.3).
         */
        if (fromProject) {
          return refused(
            "provider_not_configured",
            "Il modello di questo progetto non ha una chiave. Inseriscila nella scheda " +
              "«Modello» delle impostazioni del progetto.",
          );
        }

        const missing = providers
          .map((provider) => apiKeyVariableFor(provider.name))
          .filter((name): name is string => name !== null);

        return refused(
          "provider_not_configured",
          missing.length > 0
            ? `Nessun fornitore configurato. Manca una fra: ${missing.join(", ")}.`
            : "Nessun fornitore configurato.",
        );
      }

      let last: LlmProviderError | null = null;

      for (const provider of usable) {
        try {
          const response: LlmResponse = await provider.complete(request);

          return {
            ok: true,
            text: response.text,
            provider: provider.name,
            model: response.model,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            estimatedCostUsd: estimateCostUsd(
              provider.name,
              response.inputTokens,
              response.outputTokens,
            ),
            durationMs: elapsed(),
          };
        } catch (error) {
          last = classify(error);

          /*
           * Only a retryable failure is worth the backup.
           *
           * A malformed request fails identically everywhere, so trying again
           * would double the latency to reach the same answer — and, on a real
           * vendor, spend a second call to learn nothing.
           */
          if (!last.retryable) break;
        }
      }

      const failed = last ?? new LlmProviderError("provider_unavailable", "Nessuna risposta.", true);

      return {
        ok: false,
        failureCause: failed.failureCause,
        message: failed.message,
        // Which provider was last tried is worth recording even in failure:
        // "Gemini timed out" and "nobody was configured" call for different
        // actions from whoever reads the register.
        provider: usable[usable.length - 1]?.name ?? null,
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        durationMs: elapsed(),
      };
    },
  };
}
