import { connectorReady, providerNeedsKey, type BrainProvider, type ConnectorChoice } from "@/domain";

/**
 * Che cosa manca a un progetto appena creato per fare qualcosa.
 *
 * ## Perché esiste
 *
 * Un progetto nasce vuoto, e la sua dashboard lo dice nove volte di fila: «—»,
 * «campione vuoto», «nessun dato». Ogni riga è **corretta** — nessun numero è
 * inventato, che è la regola R1 — e messe insieme formano una schermata
 * indistinguibile da un guasto per chi ha appena premuto «Crea il progetto».
 *
 * Il difetto non è nei numeri: è che nessuno dice **cosa fare**. Il portale sa
 * benissimo che manca una fonte dati, ma lo tiene per sé e lascia al lettore il
 * compito di dedurlo da nove assenze.
 *
 * ## Perché non è un modulo di creazione più lungo
 *
 * La richiesta naturale è «mettiamo tutto nella finestra di creazione». Ha un
 * costo che si paga subito: configurare Jira richiede un token da prendere su
 * Atlassian, il modello una chiave da prendere su Google. Un modulo che li
 * pretende **impedisce di creare un progetto** finché non si è fatto un giro su
 * due siti esterni — e chi voleva solo prendere posto per un progetto che parte
 * la settimana prossima resta fuori.
 *
 * Qui invece la creazione resta di tre campi, e ciò che manca è **visibile e
 * raggiungibile** dalla pagina del progetto finché non è fatto. Costa quindici
 * secondi in più a chi ha tutto pronto, e non blocca nessuno.
 *
 * ## Che cosa non è
 *
 * Non è una percentuale di completamento né una barra di avanzamento. Un
 * progetto con la sola fonte dati collegata è **pienamente utilizzabile** —
 * metriche, grafici, elenchi — e dirgli «40%» sarebbe falso. I passi sono
 * indipendenti, e ognuno dice cosa si guadagna facendolo.
 */

/** Che cosa si può ancora fare, e a che cosa serve. */
export type OnboardingStep = {
  readonly id: "dati" | "modello" | "agente";
  readonly title: string;
  /** Che cosa si guadagna, non che cosa si compila. */
  readonly benefit: string;
  readonly href: string;
  readonly done: boolean;
  /** Perché conviene farlo adesso. `null` quando è già fatto. */
  readonly hint: string | null;
};

export type OnboardingInput = {
  readonly slug: string;
  readonly connector: ConnectorChoice | null;
  readonly connectorConfigured: boolean;
  readonly brainProvider: BrainProvider;
  readonly brainKeyPresent: boolean;
  /** Se esiste già uno Scrum Master AI per questo progetto. */
  readonly hasAgent: boolean;
};

export type Onboarding = {
  readonly steps: readonly OnboardingStep[];
  /** Quanti restano. Zero significa che la sezione non va mostrata affatto. */
  readonly remaining: number;
  /**
   * Se il progetto non ha ancora **alcun** dato.
   *
   * Distinto da «restano dei passi»: un progetto con i dati collegati e senza
   * modello ha una dashboard piena di numeri veri, e per lui l'elenco dei passi
   * è un suggerimento. Senza dati invece la dashboard è vuota, e l'elenco è
   * l'unica cosa che vale la pena leggere.
   */
  readonly empty: boolean;
};

export function onboarding(input: OnboardingInput): Onboarding {
  const dataDone = input.connector !== null && input.connectorConfigured;

  /*
   * Il modello conta come «scelto» anche restando su `fake`.
   *
   * `fake` non è un ripiego né una configurazione mancante: è una scelta
   * legittima e documentata — i numeri restano veri, cambiano solo i testi che
   * li accompagnano. Segnarlo come «da fare» significherebbe insistere perché
   * qualcuno spenda soldi in una funzione che ha deciso di non usare.
   *
   * Resta «da fare» solo il caso incoerente: un fornitore vero dichiarato senza
   * la chiave che gli serve.
   */
  const brainDone =
    input.brainProvider === "fake" ||
    !providerNeedsKey(input.brainProvider) ||
    input.brainKeyPresent;

  const steps: readonly OnboardingStep[] = [
    {
      id: "dati",
      title: "Collega una fonte dati",
      benefit: "Sprint, elementi e metriche arrivano da qui. Senza, le schermate restano vuote.",
      href: `/progetti/${input.slug}/impostazioni?sezione=dati`,
      done: dataDone,
      hint: dataDone
        ? null
        : "Jira Cloud per un progetto vero, «dati di esempio» per vedere come funziona il portale senza collegare nulla.",
    },
    {
      id: "modello",
      title: "Scegli il modello che racconta i numeri",
      benefit:
        "I numeri li calcola sempre il codice: il modello scrive i testi che li accompagnano.",
      href: `/progetti/${input.slug}/impostazioni?sezione=modello`,
      done: brainDone,
      hint: brainDone
        ? null
        : "Hai scelto un fornitore che richiede una chiave, ma la chiave non c'è ancora.",
    },
    {
      id: "agente",
      title: "Crea lo Scrum Master AI",
      benefit: "Resoconti di sprint, digest giornalieri e risposte sul progetto.",
      href: `/progetti/${input.slug}/scrum-master`,
      done: input.hasAgent,
      hint: input.hasAgent
        ? null
        : "Si può fare anche dopo: le metriche e i grafici funzionano senza.",
    },
  ];

  return {
    steps,
    remaining: steps.filter((step) => !step.done).length,
    empty: !dataDone,
  };
}

/** Riassume `SafeProjectSettings` in ciò che serve qui, senza toccare i segreti. */
export function onboardingFromSettings(input: {
  readonly slug: string;
  readonly connector: ConnectorChoice | null;
  readonly connectorConfig: Record<string, unknown>;
  readonly connectorSecretConfigured: boolean;
  readonly brainProvider: BrainProvider;
  readonly brainKeyConfigured: boolean;
  readonly hasAgent: boolean;
}): Onboarding {
  return onboarding({
    slug: input.slug,
    connector: input.connector,
    connectorConfigured: connectorReady({
      connector: input.connector,
      connectorConfig: input.connectorConfig,
      // `connectorReady` chiede il segreto, non il fatto che ci sia: qui basta
      // sapere che esiste, e un segnaposto non lascia uscire nulla.
      connectorSecret: input.connectorSecretConfigured ? "presente" : null,
    }),
    brainProvider: input.brainProvider,
    brainKeyPresent: input.brainKeyConfigured,
    hasAgent: input.hasAgent,
  });
}
