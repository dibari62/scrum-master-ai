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

/**
 * Il costo massimo di una prova, in token.
 *
 * Il tetto vale per la richiesta **intera**, istruzioni comprese: il gateway
 * stima i token prima di chiamare e rifiuta se la stima lo supera. Con un tetto
 * troppo stretto la prova fallirebbe per «budget superato» senza mai
 * telefonare, cioè col messaggio più fuorviante possibile per chi sta
 * verificando una chiave.
 */
const CHECK_BUDGET = 256;

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
      /**
       * I modelli che quella credenziale può usare, quando si è potuto chiederlo.
       *
       * Vuoto quando la domanda non è stata fatta o non ha avuto risposta: come
       * per la diagnosi di una lettura Jira a vuoto, un elenco inventato sarebbe
       * peggio di nessun elenco.
       */
      readonly availableModels: readonly string[];

      /**
       * Il codice HTTP del rifiuto, quando c'è stato.
       *
       * Si mostra a chi legge, e non è un dettaglio da tecnici: `404` e `429`
       * portano a due gesti opposti — correggere un nome, oppure aspettare — e
       * senza quel numero le due situazioni si somigliano troppo.
       */
      readonly providerStatus: number | null;
    };

export type ModelCheckInput = {
  readonly gateway: Gateway;
  readonly provider: LlmProvider;
  readonly language?: string | undefined;

  /**
   * Come si chiede al fornitore quali modelli conosce.
   *
   * Iniettata, e usata **solo** quando la richiesta è stata rifiutata dopo che
   * la chiave era stata riconosciuta: è l'unico caso in cui la risposta cambia
   * ciò che si dice a chi legge, ed è una chiamata in più che non ha senso
   * spendere quando tutto funziona.
   */
  readonly listModels?: (() => Promise<readonly string[]>) | undefined;
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
      availableModels: await askForModels(outcome.failureCause, input.listModels),
      providerStatus: outcome.providerStatus,
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
 * L'elenco dei modelli, chiesto solo quando cambia la risposta.
 *
 * Una richiesta rifiutata *dopo* che la chiave è stata riconosciuta è l'unico
 * caso in cui il nome del modello è il sospetto principale. Su una chiave
 * assente la domanda fallirebbe per la stessa ragione, e su una quota esaurita
 * sarebbe una chiamata in più per confermare ciò che già si sa.
 *
 * Un fallimento della sonda non è un errore da propagare: la prova ha già il
 * suo esito, e l'elenco è un di più.
 */
async function askForModels(
  cause: SkillRunFailureCause,
  listModels: (() => Promise<readonly string[]>) | undefined,
): Promise<readonly string[]> {
  if (cause !== "provider_unavailable" || listModels === undefined) return [];

  try {
    return await listModels();
  } catch {
    return [];
  }
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
      /*
       * Due situazioni sotto la stessa causa, e vanno dette entrambe.
       *
       * Gli adattatori usano `provider_not_configured` sia quando la chiave non
       * c'è, sia quando il fornitore l'ha **rifiutata** con un 401 o un 403 —
       * che è una cosa diversa e più frequente. Scrivere solo «manca la chiave»
       * a chi ne ha appena incollata una lo manda a cercare un campo vuoto che
       * vuoto non è.
       */
      return (
        "La chiave non c'è, oppure il fornitore l'ha rifiutata: revocata, scaduta, " +
        "o incollata con uno spazio di troppo. Rigenerala e reinseriscila qui sotto."
      );

    case "provider_unavailable":
      /*
       * Il caso in cui la chiave è quasi certamente buona.
       *
       * Un 401 sarebbe arrivato come `provider_not_configured`: se siamo qui, il
       * fornitore ci ha riconosciuti e ha rifiutato *la richiesta*. In pratica
       * significa quasi sempre un nome di modello che non esiste, o che non
       * esiste più — i nomi dei modelli cambiano spesso e in silenzio.
       */
      return (
        "Il fornitore ha riconosciuto la chiave ma ha rifiutato la richiesta, oppure non era " +
        "raggiungibile. La causa di gran lunga più frequente è un nome di modello che quel " +
        "fornitore non conosce: controlla il campo «Modello», o lascialo vuoto per usare il predefinito."
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
