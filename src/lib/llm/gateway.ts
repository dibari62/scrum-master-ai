import {
  llmProviderSchema,
  type LlmProvider,
  type SkillRunFailureCause,
} from "@/domain";

import { countTokens, createFakeProvider, renderRequest } from "./fake";
import { createGoogleProvider } from "./google";
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
  readonly env?: EnvironmentSlice | undefined;

  /**
   * The project's own credentials, when it has them (ADR-0010).
   *
   * When present they **win over the environment**: a project that declared a
   * provider must be served by that one, or its report would be written on
   * somebody else's quota — ours.
   */
  readonly credentials?: ProjectCredentials | undefined;
};

export type Gateway = {
  readonly complete: (request: LlmRequest) => Promise<GatewayOutcome>;
};

/**
 * Which provider the environment asks for.
 *
 * An unrecognised value falls back to `fake` rather than throwing. The
 * alternative — refusing to start — turns a typo in a dashboard into a dead
 * application, whereas this turns it into a run that visibly did not reach a
 * vendor. Both are wrong; only one of them can be diagnosed from the register.
 */
export function selectedProvider(env: EnvironmentSlice = process.env): LlmProvider {
  const parsed = llmProviderSchema.safeParse(env["LLM_PROVIDER"]);
  return parsed.success ? parsed.data : "fake";
}

/**
 * The credential each provider reads.
 *
 * One per provider, never a shared one: ADR-0005 is explicit that *«una riserva
 * che richiede di riscrivere a mano la credenziale non è una riserva»*.
 */
const API_KEY_VARIABLE: Readonly<Record<LlmProvider, string | null>> = {
  fake: null,
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
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
  /** `null` for `fake`, which answers without calling anyone. */
  readonly apiKey: string | null;
  readonly model?: string | null | undefined;
};

/**
 * The chain the gateway will try, primary first.
 *
 * `fake` is never mixed with real providers: a demonstration that quietly
 * degraded to invented text would be indistinguishable from one that worked.
 *
 * **Con le credenziali di un progetto non c'è riserva, ed è voluto.** La riserva
 * di ADR-0005 esisteva perché le chiavi erano nostre e le avevamo entrambe. La
 * chiave di un cliente è una sola: dirottare il suo lavoro su un fornitore che
 * non ha scelto significherebbe spendere una quota che non ci ha dato, o
 * fallire con un messaggio che parla di un servizio di cui non sa nulla.
 */
export function defaultProviders(
  env: EnvironmentSlice = process.env,
  credentials?: ProjectCredentials | undefined,
): readonly LlmProviderAdapter[] {
  if (credentials) {
    if (credentials.provider === "fake") return [createFakeProvider()];

    if (credentials.provider === "gemini") {
      return [
        createGoogleProvider({
          apiKey: credentials.apiKey ?? "",
          model: credentials.model,
        }),
      ];
    }

    return [createUnimplementedProvider(credentials.provider)];
  }

  const selected = selectedProvider(env);

  if (selected === "fake") return [createFakeProvider()];

  if (selected === "gemini") {
    return [
      createGoogleProvider({
        apiKey: env["GEMINI_API_KEY"] ?? "",
        model: env["LLM_MODEL"] ?? null,
      }),
      createUnimplementedProvider("groq"),
    ];
  }

  return [createUnimplementedProvider(selected), createUnimplementedProvider("gemini")];
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

export function createGateway(options: GatewayOptions = {}): Gateway {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const providers = options.providers ?? defaultProviders(env, options.credentials);

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
        const missing = providers
          .map((provider) => apiKeyVariableFor(provider.name))
          .filter((name): name is string => name !== null);

        return refused(
          "provider_not_configured",
          missing.length > 0
            ? // The variable name, never its value: a message is a place a
              // secret escapes to logs and screenshots (§8.3).
              `Nessun fornitore configurato. Manca una fra: ${missing.join(", ")}.`
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
