import type { LlmProvider, SkillRunFailureCause } from "@/domain";
import type { Gateway } from "@/lib/llm";

/**
 * «Questa chiave funziona?», chiesto prima di scoprirlo per sbaglio.
 *
 * **Perché serve, visto che una prova esiste già.** Il diario dello Scrum
 * Master AI ha «Prova il collegamento», ma sta due schermate più in là e
 * pretende che l'agente sia già stato creato. Chi ha appena incollato una
 * chiave nelle impostazioni non ha modo di sapere se è quella giusta: lo
 * scoprirebbe alla prima relazione di sprint, cioè nel momento peggiore.
 *
 * **Che cosa prova, esattamente.** Che con questo fornitore, questo modello e
 * questa chiave si ottiene una risposta. Non prova che i rapporti saranno
 * belli, né che il modello sia adatto: prova che la linea esiste. È poco, ed è
 * esattamente ciò che non si può dedurre da nessun'altra parte.
 *
 * **Non tocca alcun dato del progetto** (§8.1): non ci sono elementi, metriche
 * né testo ingerito nella richiesta. Non c'è niente che un contenuto di terzi
 * possa influenzare, perché non ne entra nessuno.
 */

/** Il costo massimo di una prova, in token. */
const CHECK_BUDGET = 64;

const SYSTEM = [
  "Questa è una verifica tecnica di connessione, non una richiesta di lavoro.",
  "Rispondi con una sola parola: pronto.",
].join(" ");

export type ModelCheckOutcome =
  | {
      readonly kind: "ok";
      readonly provider: LlmProvider;
      readonly model: string;
      readonly durationMs: number;
      readonly costUsd: number;
      /** La risposta del modello, tagliata: serve a mostrare che ha davvero parlato. */
      readonly reply: string;
    }
  | {
      readonly kind: "fake";
    }
  | {
      readonly kind: "failed";
      readonly cause: SkillRunFailureCause;
      readonly message: string;
    };

export type ModelCheckInput = {
  readonly gateway: Gateway;
  readonly provider: LlmProvider;
  readonly language?: string | undefined;
};

/**
 * Manda una richiesta minima e racconta com'è andata.
 *
 * Il gateway arriva come argomento perché §9 vieta chiamate a un modello nei
 * test: qui si verifica *come si legge un esito*, che è la parte che può
 * sbagliare, e la parte che telefona è già provata altrove.
 */
export async function checkModel(input: ModelCheckInput): Promise<ModelCheckOutcome> {
  /*
   * Il fornitore finto non si prova: non c'è nulla da provare.
   *
   * Risponde sempre, quindi un esito «riuscito» direbbe soltanto che il codice
   * gira. Dirlo apertamente vale più di un semaforo verde che non significa
   * niente — e `fake` è una scelta legittima, non un guasto: i numeri restano
   * veri, cambia solo chi li racconta.
   */
  if (input.provider === "fake") return { kind: "fake" };

  const outcome = await input.gateway.complete({
    system: SYSTEM,
    prompt: "Confermi di aver ricevuto questa richiesta?",
    maxTokens: CHECK_BUDGET,
    language: input.language ?? "it",
    stubResponse: "pronto",
  });

  if (!outcome.ok) {
    return {
      kind: "failed",
      cause: outcome.failureCause,
      message: explainFailure(outcome.failureCause),
    };
  }

  return {
    kind: "ok",
    provider: outcome.provider,
    model: outcome.model,
    durationMs: outcome.durationMs,
    costUsd: outcome.estimatedCostUsd,
    reply: outcome.text.trim().slice(0, 200),
  };
}

/**
 * Che cosa fare, per ciascun modo di fallire.
 *
 * Ogni frase nomina il gesto successivo. «Errore del fornitore» è vero e
 * inservibile: chi lo legge deve comunque indovinare se il problema sia la
 * chiave, il nome del modello, la quota o la rete.
 *
 * Il messaggio del fornitore **non** viene riportato: può contenere frammenti
 * della richiesta e in certi casi la chiave stessa (§8.3). Chi amministra lo
 * trova nel registro del server.
 */
function explainFailure(cause: SkillRunFailureCause): string {
  switch (cause) {
    case "provider_not_configured":
      return "Manca la chiave API, oppure non è leggibile. Reinseriscila qui sotto e salva.";

    case "provider_unavailable":
      return (
        "Il fornitore ha rifiutato la richiesta. Le due cause di gran lunga più frequenti " +
        "sono una chiave non valida (o revocata) e un nome di modello che quel fornitore non conosce."
      );

    case "rate_limited":
      return (
        "Il fornitore ha chiesto di rallentare. La chiave funziona: è la quota al minuto " +
        "che è esaurita. Riprova fra qualche istante."
      );

    case "quota_exceeded":
      return "La quota del tuo piano presso il fornitore è esaurita. La chiave è valida, il credito no.";

    case "timeout":
      return "Il fornitore non ha risposto in tempo. Non dice nulla sulla chiave: riprova.";

    case "invalid_output":
      return "Il fornitore ha risposto qualcosa che non siamo riusciti a leggere. Il collegamento c'è, la risposta no.";

    case "budget_exceeded":
      return "La prova ha superato il budget di token previsto, il che non dovrebbe succedere: segnalalo.";

    case "agent_suspended":
      // Non raggiungibile da qui: la prova non passa dall'agente. Dichiarato
      // invece che omesso, perché un `default` silenzioso nasconderebbe il
      // giorno in cui questa funzione venisse chiamata da un altro posto.
      return "L'agente è sospeso.";
  }
}
