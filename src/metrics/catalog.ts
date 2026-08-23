import { metricCatalogSchema, type MetricCatalog } from "@/domain";

/**
 * Every metric the application shows, and how each one is produced.
 *
 * **The point of this file.** R1 says the code calculates and the model
 * narrates. That rule is only worth something if a reader can check it, and
 * checking it meant reading TypeScript until now. This is the same information
 * addressed to whoever is looking at the number.
 *
 * Written as data and validated on load, not as a page of prose, because prose
 * about a calculation drifts away from the calculation. `catalog.test.ts` walks
 * the engine and fails when a metric is exported without an entry here, so the
 * drift is caught rather than discovered by a reader who trusted the page.
 *
 * The exclusions are not padding. Nearly every misreading of a metric comes
 * from assuming it counts something it deliberately leaves out.
 */
export const METRIC_CATALOG: MetricCatalog = metricCatalogSchema.parse([
  {
    id: "cycle-time",
    name: "Cycle time",
    question: "Quanto tempo passa da quando il team prende in mano un elemento a quando lo chiude?",
    formula:
      "Dal primo ingresso in «in lavorazione» al primo ingresso in «concluso». Entrambi gli estremi sono il *primo* passaggio: un elemento riaperto e richiuso ha comunque impiegato, la prima volta, il tempo che ha impiegato.",
    unit: "duration",
    excludes: [
      "Il tempo passato in backlog prima di essere preso in carico (quello è il lead time).",
      "Le riaperture successive alla prima chiusura, contate a parte dal tasso di riapertura.",
    ],
    unavailableWhen:
      "L'elemento non è mai entrato in lavorazione, o non è mai arrivato a conclusione.",
    decision:
      "Misurare fino all'ultima chiusura farebbe sembrare una riapertura una consegna più lenta, mentre è rilavorazione: due fenomeni diversi che meritano due numeri diversi.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "cycleTime",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "lead-time",
    name: "Lead time",
    question: "Quanto aspetta chi ha chiesto una cosa, dal momento in cui l'ha chiesta?",
    formula:
      "Dalla creazione dell'elemento nello strumento di origine al primo ingresso in «concluso».",
    unit: "duration",
    excludes: ["Nulla: è il tempo totale, attesa in backlog inclusa."],
    unavailableWhen: "L'elemento non è mai arrivato a conclusione.",
    decision:
      "È più lungo del cycle time esattamente del tempo di attesa in backlog, e quella differenza è di solito il numero più interessante: il lead time è ciò che vive chi chiede, il cycle time è ciò che vive il team.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "leadTime",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "flow-efficiency",
    name: "Efficienza di flusso",
    question: "Di tutto il tempo in cui un elemento è stato in viaggio, quanto è stato lavorazione vera e quanto attesa?",
    formula:
      "Tempo negli stati che aggiungono valore diviso il tempo totale trascorso, misurato dal primo ingresso in lavorazione.",
    unit: "ratio",
    excludes: [
      "Il tempo in backlog: non è un'inefficienza di flusso, è una decisione di priorità.",
      "La revisione, che conta come attesa e non come lavorazione.",
    ],
    unavailableWhen: "L'elemento non è mai entrato in lavorazione.",
    decision:
      "Questione Q1, decisa dal Product Owner: «in revisione» occupa il team (conta nel lavoro in corso) ma non è lavorazione. Con la definizione precedente questa metrica leggeva un 100% costante su dati in cui l'attesa in revisione cresceva di giorno in giorno. Nel software i valori riportati in letteratura stanno fra il 5% e il 15%: un numero che non può scendere sotto una soglia è una costante travestita da misura.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "flowEfficiency",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "review-wait",
    name: "Attesa in revisione",
    question: "Quanto resta fermo un elemento da quando entra in revisione a quando qualcuno lo sblocca?",
    formula:
      "Durata dell'ultimo tratto passato in «in revisione». Se è ancora lì, si conta fino a adesso.",
    unit: "duration",
    excludes: [
      "I giri di revisione precedenti: interessa quanto dura l'attesa attuale, non la somma storica.",
    ],
    unavailableWhen: "L'elemento non è mai entrato in revisione.",
    decision:
      "Sta accanto all'efficienza di flusso e non da sola: l'efficienza dice che del tempo si è perso, questa dice dove. Mostrarne una senza l'altra è stato un errore dichiarato di una versione precedente della dashboard.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "reviewWaitTime",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "reopen-rate",
    name: "Tasso di riapertura",
    question: "Quanta parte del lavoro dichiarato finito è tornata indietro?",
    formula:
      "Elementi riaperti almeno una volta, divisi per gli elementi arrivati a conclusione.",
    unit: "ratio",
    excludes: [
      "Gli elementi mai conclusi: non possono essere riaperti, e metterli al denominatore diluirebbe il tasso fino a renderlo insignificante.",
    ],
    unavailableWhen: "Nessun elemento è mai arrivato a conclusione.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "summariseFlow",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "aging",
    name: "Aging",
    question: "Da quanto tempo un elemento non finito è fermo nello stato in cui si trova?",
    formula: "Da quando è entrato nello stato attuale a adesso.",
    unit: "duration",
    excludes: [
      "Il lavoro già concluso: l'aging serve a far emergere ciò che è fermo *ora*, e includere il passato seppellirebbe il segnale sotto la storia.",
    ],
    unavailableWhen: "L'elemento è concluso o annullato.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "agingWorkItem",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "blocked-time",
    name: "Tempo bloccato",
    question: "Quanto tempo complessivo un elemento è rimasto bloccato?",
    formula: "Somma di tutti i tratti passati nello stato «bloccato».",
    unit: "duration",
    excludes: ["Nulla: qui la somma di tutti i tratti è proprio ciò che si vuole."],
    unavailableWhen: "Mai: se non è mai stato bloccato il risultato è zero, che qui è un'informazione vera.",
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "blockedTime",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "velocity",
    name: "Velocity",
    question: "Quanto lavoro stimato il team ha effettivamente chiuso in uno sprint?",
    formula:
      "Somma delle stime degli elementi che risultavano «conclusi» nell'istante di chiusura dello sprint, calcolata separatamente per ogni unità di stima.",
    unit: "points",
    excludes: [
      "Gli elementi conclusi e poi riaperti prima della fine: alla chiusura non erano conclusi.",
      "Gli elementi entrati e poi usciti dallo sprint.",
      "Le stime in unità diverse, che non vengono mai sommate fra loro.",
    ],
    unavailableWhen: "Lo sprint non conteneva alcun elemento.",
    decision:
      "Unità di stima diverse restano separate. Sommare tre punti e mezza giornata produce un numero che non significa nulla, e nessun grafico può accorgersene dopo.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "velocity",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "scope-change",
    name: "Cambio di perimetro",
    question: "Quanto lavoro è entrato o uscito dallo sprint dopo che era già cominciato?",
    formula:
      "Elementi aggiunti o rimossi in un istante successivo, in senso stretto, all'inizio dello sprint.",
    unit: "count",
    excludes: [
      "Gli elementi presenti esattamente all'istante di inizio: quelli sono l'impegno preso, non una modifica a esso.",
    ],
    unavailableWhen: "Non risulta alcun evento di composizione per lo sprint.",
    decision:
      "Il confronto con l'istante di inizio è stretto. Trattare come aggiunte gli elementi presenti all'inizio riporterebbe ogni sprint come cento per cento di rimescolamento.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "scopeChange",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "carry-over",
    name: "Lavoro trascinato",
    question: "Quanto lavoro è rimasto aperto alla chiusura dello sprint?",
    formula:
      "Elementi che appartenevano allo sprint alla sua chiusura e non erano né conclusi né annullati.",
    unit: "count",
    excludes: [
      "Gli elementi annullati: rinunciare a un lavoro non è non essere riusciti a finirlo.",
    ],
    unavailableWhen: "Lo sprint non conteneva alcun elemento.",
    decision:
      "Non si richiede che l'elemento ricompaia nello sprint successivo. Quello sprint potrebbe non esistere ancora, e un elemento non finito che nessuno riprende è un segnale più forte, non più debole, di uno che viene trascinato avanti.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "carryOver",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "burndown",
    name: "Burndown",
    question: "Giorno per giorno, quanto lavoro restava aperto nello sprint?",
    formula:
      "Un campione al giorno, preso all'ora di inizio dello sprint, di quanto lavoro risultava ancora aperto in quell'istante.",
    unit: "points",
    excludes: [
      "Nulla: la composizione dello sprint viene ricalcolata a ogni campione, così un elemento aggiunto a metà appare nel punto in cui è entrato.",
    ],
    unavailableWhen: "Lo sprint non ha una durata valida.",
    decision:
      "Il campione è all'ora di inizio e non a mezzanotte, così ogni punto risponde a «dov'eravamo ieri a quest'ora», che è il confronto che un team fa davvero.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "burndown",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "throughput",
    name: "Throughput",
    question: "Quanti elementi sono arrivati a conclusione in un certo intervallo?",
    formula: "Conteggio degli elementi il cui primo ingresso in «concluso» cade nell'intervallo.",
    unit: "items-per-sprint",
    excludes: [
      "Le stime: è deliberatamente un conteggio, così resta confrontabile fra team che stimano in modi diversi o non stimano affatto.",
    ],
    unavailableWhen: "L'intervallo richiesto è vuoto o rovesciato.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "throughput",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "work-in-progress",
    name: "Lavoro in corso",
    question: "Quanti elementi il team ha in carico contemporaneamente in questo momento?",
    formula: "Elementi che in questo istante risultano «in lavorazione» oppure «in revisione».",
    unit: "count",
    excludes: [
      "Gli elementi bloccati: un elemento che nessuno può muovere non è lavoro in corso.",
      "Backlog, concluso e annullato.",
    ],
    unavailableWhen: "Non esiste alcuna storia di stati da cui ricavarlo.",
    decision:
      "Questione Q2, ancora aperta: escludere i bloccati lascia sembrare libero un team che in realtà ha del lavoro fermo fra le mani. La scelta attuale è dichiarata, non implicita.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "workInProgress",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "sprint-length",
    name: "Durata tipica dello sprint",
    question: "Di quanti giorni sono, di solito, gli sprint di questo team?",
    formula: "Mediana della durata degli sprint passati, arrotondata a giorni interi.",
    unit: "count",
    excludes: [
      "Gli sprint con date incoerenti, che finiscono prima di cominciare: sono un difetto della fonte, e trattarli come zero giorni accorcerebbe silenziosamente la proposta.",
    ],
    unavailableWhen: "Ci sono meno di due sprint utilizzabili: uno solo è un caso, non un'abitudine.",
    decision:
      "La mediana e non la media: uno sprint accorciato da una festività trascinerebbe una media lontano dalla durata a cui il team lavora davvero.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "typicalSprintLengthDays",
    testFile: "tests/metrics/sprint.test.ts",
  },
]);
