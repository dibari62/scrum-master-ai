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
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia dei passaggi di stato dell'elemento, per trovare il primo ingresso in «in lavorazione» e il primo in «concluso»",
      },
    ],
    observation: {
      kind: "between",
      from: "il primo ingresso in «in lavorazione»",
      to: "il primo ingresso in «concluso»",
    },
    operation: "elapsed",
    summarisedBy: ["mean", "median", "p85"],
    sampleSizeMeaning:
      "uno: è la misura di un singolo elemento. Sulla dashboard la numerosità che accompagna il valore è quella dell'insieme riassunto da summariseFlow, cioè quanti elementi hanno prodotto un cycle time.",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "L'elemento è stato concluso, riaperto e richiuso.",
        outcome:
          "Vale il primo «concluso»: la seconda lavorazione è rilavorazione, e la conta il tasso di riapertura.",
        verifiedBy: "usa il PRIMO done anche se l'elemento è stato riaperto e richiuso",
      },
      {
        situation: "L'elemento è arrivato a «concluso» senza mai passare da «in lavorazione».",
        outcome: "Nessun valore, con motivo «no-qualifying-data»: non una durata di zero.",
        verifiedBy:
          "non è disponibile se l'elemento è arrivato a done senza passare da in_progress",
      },
      {
        situation: "Dell'elemento non risulta alcuna transizione.",
        outcome: "Nessun valore: non c'è nulla fra cui misurare.",
        verifiedBy: "non è disponibile su una storia vuota",
      },
    ],
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
    inputs: [
      {
        entity: "WorkItem",
        reads: "l'istante in cui l'elemento è stato creato nello strumento di origine",
      },
      {
        entity: "StateTransition",
        reads: "la storia degli stati, per trovare il primo ingresso in «concluso»",
      },
    ],
    observation: {
      kind: "between",
      from: "la creazione dell'elemento nello strumento di origine",
      to: "il primo ingresso in «concluso»",
    },
    operation: "elapsed",
    summarisedBy: ["mean", "median", "p85"],
    sampleSizeMeaning:
      "uno: è la misura di un singolo elemento. Sulla dashboard la numerosità è quella dell'insieme, cioè quanti elementi hanno prodotto un lead time.",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "L'elemento ha atteso a lungo in backlog prima di essere preso in carico.",
        outcome: "Il lead time supera il cycle time esattamente di quell'attesa.",
        verifiedBy: "è più lungo del cycle time quando l'elemento ha atteso in backlog",
      },
      {
        situation: "L'elemento non è mai arrivato a conclusione.",
        outcome: "Nessun valore, con motivo «no-qualifying-data».",
        verifiedBy: "non è disponibile per un elemento non concluso",
      },
    ],
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
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia degli stati, scomposta nei tratti passati in ciascuno stato: quelli che aggiungono valore stanno al numeratore, tutti quelli dopo l'inizio della lavorazione al denominatore",
      },
    ],
    observation: {
      kind: "between",
      from: "il primo ingresso in «in lavorazione»",
      to: "il primo ingresso in «concluso», oppure l'istante di riferimento se l'elemento è ancora aperto",
    },
    operation: "ratio",
    summarisedBy: ["mean", "median", "p85"],
    sampleSizeMeaning:
      "uno: è il rapporto di un singolo elemento. Sulla dashboard la numerosità è quanti elementi hanno prodotto un rapporto calcolabile.",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "L'elemento non ha mai atteso: dall'inizio alla fine è stato in lavorazione.",
        outcome: "Uno, cioè il cento per cento.",
        verifiedBy: "è 1 quando non c'è stata attesa",
      },
      {
        situation: "L'elemento resta fermo in attesa di revisione.",
        outcome: "Il rapporto scende: la revisione è attesa, non lavorazione (questione Q1).",
        verifiedBy: "scende quando l'elemento resta in attesa di revisione",
      },
      {
        situation: "L'elemento ha atteso a lungo in backlog prima di essere preso in carico.",
        outcome: "Il rapporto non cambia: la misura parte dall'inizio della lavorazione.",
        verifiedBy: "non conta l'attesa in backlog come inefficienza",
      },
      {
        situation: "Il lavoro sull'elemento non è mai iniziato.",
        outcome: "Nessun valore, con motivo «no-qualifying-data».",
        verifiedBy: "non è disponibile se il lavoro non è mai iniziato",
      },
    ],
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
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia degli stati, per individuare l'ultimo ingresso in «in revisione» e la durata di quel tratto",
      },
    ],
    observation: {
      kind: "between",
      from: "l'ultimo ingresso in «in revisione»",
      to: "l'uscita da quel tratto, oppure l'istante di riferimento se l'elemento è ancora lì",
    },
    operation: "elapsed",
    summarisedBy: ["mean", "median", "p85"],
    sampleSizeMeaning:
      "uno: è l'attesa di un singolo elemento. Sulla dashboard la numerosità è quanti elementi sono passati da una revisione.",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "L'elemento è passato più volte in revisione.",
        outcome: "Vale solo l'ultimo tratto, non la somma dei giri precedenti.",
        verifiedBy: "usa l'ULTIMA revisione, non la somma di tutte",
      },
      {
        situation: "L'elemento è in revisione in questo momento.",
        outcome: "L'attesa si conta fino all'istante di riferimento.",
        verifiedBy: "misura l'attesa ancora in corso",
      },
      {
        situation: "L'elemento non è mai entrato in revisione.",
        outcome: "Nessun valore, con motivo «no-qualifying-data»: non un'attesa di zero.",
        verifiedBy: "non è disponibile se non è mai stato in revisione",
      },
    ],
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
    inputs: [
      {
        entity: "WorkItem",
        reads: "l'insieme degli elementi considerati, che è il perimetro del tasso",
      },
      {
        entity: "StateTransition",
        reads:
          "la storia di ciascun elemento, per contare chi è arrivato a «concluso» e chi ne è poi uscito almeno una volta",
      },
    ],
    observation: {
      kind: "history",
      over: "l'intera storia degli elementi considerati, senza limiti di finestra",
    },
    operation: "ratio",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi sono arrivati a conclusione, cioè il denominatore del tasso — non quanti elementi sono stati esaminati",
    referenceInstant: "parametro asOf, usato dalle altre misure riassunte insieme a questa",
    edgeCases: [
      {
        situation: "L'insieme non contiene elementi conclusi.",
        outcome: "Nessun valore, con motivo «empty-denominator»: non un tasso di zero.",
        verifiedBy: "su un insieme vuoto dichiara l'indisponibilità invece di restituire zero",
      },
      {
        situation: "L'insieme contiene elementi mai conclusi.",
        outcome:
          "Restano fuori dal denominatore, ma sono contati fra gli elementi considerati.",
        verifiedBy: "calcola il tasso di riapertura sui soli elementi conclusi",
      },
      {
        situation: "Le transizioni arrivano fuori ordine cronologico.",
        outcome: "Il risultato non cambia: la storia viene riordinata prima di essere letta.",
        verifiedBy: "funziona anche con le transizioni ricevute alla rinfusa",
      },
    ],
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
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "l'ultima transizione dell'elemento: dice in quale stato si trova e da quando ci è entrato",
      },
    ],
    observation: {
      kind: "between",
      from: "l'ingresso nello stato attuale",
      to: "l'istante di riferimento",
    },
    operation: "elapsed",
    summarisedBy: [],
    sampleSizeMeaning: "uno: l'aging è una misura per elemento, mai aggregata sull'insieme",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "L'elemento è concluso.",
        outcome:
          "Nessun valore, con motivo «no-qualifying-data»: l'aging riguarda ciò che è fermo adesso.",
        verifiedBy: "non si applica a un elemento concluso",
      },
      {
        situation: "L'elemento è annullato.",
        outcome: "Nessun valore: vale la stessa ragione del caso precedente.",
        verifiedBy: "non si applica a un elemento annullato",
      },
      {
        situation: "Dell'elemento non risulta alcuna transizione.",
        outcome: "Nessun valore, con motivo «no-data»: non si sa nemmeno dove si trovi.",
        verifiedBy: "non è disponibile senza storia",
      },
    ],
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
    inputs: [
      {
        entity: "StateTransition",
        reads: "tutti i tratti passati nello stato «bloccato», con la loro durata",
      },
    ],
    observation: {
      kind: "history",
      over:
        "l'intera storia dell'elemento fino all'istante di riferimento, che chiude anche un blocco ancora in corso",
    },
    operation: "sum",
    summarisedBy: [],
    sampleSizeMeaning:
      "nessuna: a differenza delle altre metriche questa restituisce una durata nuda e non un risultato con numerosità, perché non ha un caso in cui non sia calcolabile",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "L'elemento non è mai stato bloccato.",
        outcome: "Zero, che qui è una misura vera e non una lacuna.",
        verifiedBy: "è zero per un elemento mai bloccato",
      },
      {
        situation: "L'elemento è stato bloccato e sbloccato più volte.",
        outcome: "La somma di tutti i tratti, non solo dell'ultimo.",
        verifiedBy: "somma tutte le permanenze in blocked",
      },
      {
        situation: "L'elemento è bloccato in questo momento.",
        outcome: "Il blocco in corso si conta fino all'istante di riferimento.",
        verifiedBy: "conta il blocco ancora in corso fino all'istante di riferimento",
      },
    ],
    sourceFile: "src/metrics/flow.ts",
    sourceSymbol: "blockedTime",
    testFile: "tests/metrics/flow.test.ts",
  },
  {
    id: "velocity",
    name: "Velocity",
    question: "Quanto lavoro stimato il team ha effettivamente chiuso in uno sprint?",
    formula:
      "Somma delle stime **iniziali** degli elementi che risultavano «conclusi» nell'istante di chiusura dello sprint, calcolata separatamente per ogni unità di stima. «Iniziale» significa la stima che l'elemento aveva quando è entrato in questo sprint.",
    unit: "points",
    excludes: [
      "Gli elementi conclusi e poi riaperti prima della fine: alla chiusura non erano conclusi.",
      "Gli elementi entrati e poi usciti dallo sprint.",
      "Le ri-stime fatte durante lo sprint: contano solo le stime d'ingresso.",
      "Il credito parziale: un elemento quasi finito vale zero, non una frazione.",
      "Le stime in unità diverse, che non vengono mai sommate fra loro.",
    ],
    unavailableWhen: "Lo sprint non conteneva alcun elemento.",
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di chiusura effettiva, e in sua assenza la data di fine pianificata",
      },
      {
        entity: "SprintScopeEvent",
        reads:
          "gli ingressi e le uscite, per ricostruire cosa c'era dentro alla chiusura e quando ciascun elemento è entrato",
      },
      {
        entity: "StateTransition",
        reads: "la storia di ogni elemento, per sapere chi risultava concluso a quell'istante",
      },
      {
        entity: "EstimateChange",
        reads: "la stima che ogni elemento aveva nell'istante in cui è entrato nello sprint",
      },
      {
        entity: "WorkItem",
        reads:
          "la stima corrente, usata solo per gli elementi di cui la fonte non espone la storia delle stime",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di chiusura dello sprint",
    },
    operation: "sum",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi risultavano conclusi alla chiusura, cioè quanti hanno contribuito alla somma — non quanti ne conteneva lo sprint",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "La stima di un elemento viene corretta durante lo sprint.",
        outcome:
          "Conta la stima d'ingresso, non quella corretta. Altrimenti correggere una stima oggi cambierebbe la velocity di uno sprint chiuso settimane fa.",
        verifiedBy: "ignora una ri-stima fatta durante lo sprint",
      },
      {
        situation: "Un elemento entra a metà sprint e viene concluso.",
        outcome:
          "Conta con la stima che aveva all'ingresso: prima non faceva parte del piano, e non c'era nessuna stima da onorare.",
        verifiedBy: "usa la stima all'ingresso per un elemento aggiunto a metà sprint",
      },
      {
        situation: "Un elemento è stato concluso e poi riaperto prima della chiusura.",
        outcome: "Escluso: nell'istante di chiusura non risultava concluso.",
        verifiedBy: "esclude un elemento riaperto prima della chiusura",
      },
      {
        situation: "Gli elementi conclusi sono stimati in unità diverse.",
        outcome:
          "Le unità restano separate e il risultato è dichiarato parziale, invece di produrre una somma priva di senso.",
        verifiedBy: "dichiara il risultato parziale quando le unità si mescolano",
      },
      {
        situation: "Lo sprint non conteneva alcun elemento.",
        outcome: "Nessun valore, con motivo «no-data»: non una velocity di zero.",
        verifiedBy: "non è disponibile se lo sprint non contiene nulla",
      },
    ],
    decision:
      "Conta la stima iniziale, non quella corrente. È la regola del libro — «any updates to the story time estimates done during the sprint are ignored» — e senza di essa la velocity di uno sprint chiuso cambierebbe ogni volta che qualcuno corregge una stima. Unità di stima diverse restano separate: sommare tre punti e mezza giornata produce un numero che non significa nulla, e nessun grafico può accorgersene dopo.",
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
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di inizio, che è il confine oltre il quale un movimento è una variazione",
      },
      {
        entity: "SprintScopeEvent",
        reads: "ogni ingresso e ogni uscita, con il proprio istante e il proprio verso",
      },
      {
        entity: "WorkItem",
        reads: "la stima degli elementi entrati e usciti, per dire quanto lavoro si è mosso",
      },
    ],
    observation: {
      kind: "history",
      over: "dall'istante di inizio dello sprint in avanti, estremo escluso",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi c'erano all'istante di inizio, cioè l'impegno preso: è il termine di paragone rispetto a cui la variazione va letta",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Gli elementi erano già dentro all'istante di inizio.",
        outcome: "Non contano come variazione: sono l'impegno preso, non una modifica a esso.",
        verifiedBy: "non considera variazione ciò che c'era all'inizio",
      },
      {
        situation: "Un elemento è stato tolto dallo sprint dopo l'inizio.",
        outcome: "Contato fra le rimozioni, separatamente dalle aggiunte.",
        verifiedBy: "conta il lavoro rimosso a sprint iniziato",
      },
      {
        situation: "Dello sprint non risulta alcun evento di composizione.",
        outcome: "Nessun valore, con motivo «no-data»: non «nessuna variazione».",
        verifiedBy: "non è disponibile senza eventi di perimetro",
      },
    ],
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
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di chiusura effettiva, e in sua assenza la data di fine pianificata",
      },
      {
        entity: "SprintScopeEvent",
        reads: "gli ingressi e le uscite, per sapere cosa apparteneva allo sprint alla chiusura",
      },
      {
        entity: "StateTransition",
        reads: "lo stato di ciascun elemento in quell'istante",
      },
      {
        entity: "WorkItem",
        reads: "la stima degli elementi rimasti aperti",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di chiusura dello sprint",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi appartenevano allo sprint alla chiusura, conclusi o no: è il denominatore rispetto a cui la quota di trascinato ha senso",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Un elemento dello sprint è stato annullato.",
        outcome:
          "Non conta come trascinato: rinunciare a un lavoro non è non essere riusciti a finirlo.",
        verifiedBy: "non conta come trascinato ciò che è stato annullato",
      },
      {
        situation: "Lo sprint è stato chiuso dopo la data di fine pianificata.",
        outcome: "Si guarda alla chiusura effettiva, non alla data prevista.",
        verifiedBy: "usa la chiusura effettiva quando lo sprint è stato chiuso in ritardo",
      },
      {
        situation: "Lo sprint non conteneva alcun elemento.",
        outcome: "Nessun valore, con motivo «no-data»: non zero elementi trascinati.",
        verifiedBy: "nessuna metrica di sprint restituisce zero muto",
      },
    ],
    decision:
      "Non si richiede che l'elemento ricompaia nello sprint successivo. Quello sprint potrebbe non esistere ancora, e un elemento non finito che nessuno riprende è un segnale più forte, non più debole, di uno che viene trascinato avanti.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "carryOver",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "sprint-item-count",
    name: "Elementi dello sprint",
    question: "Quanti elementi conteneva lo sprint nel momento in cui si è chiuso?",
    formula:
      "Si riproducono in ordine gli ingressi e le uscite di elementi dallo sprint fino all'istante di chiusura — o fino a adesso, se lo sprint è ancora aperto — e si contano quelli rimasti dentro.",
    unit: "count",
    excludes: [
      "Gli elementi usciti dallo sprint prima della chiusura: in quel momento non ne facevano più parte.",
      "Gli elementi entrati dopo l'istante di conteggio, che per uno sprint ancora aperto è adesso.",
      "Le stime: è un conteggio di elementi, non una quantità di lavoro.",
    ],
    unavailableWhen:
      "Per lo sprint non risulta alcuna variazione di perimetro: non si sa cosa contenesse, e «zero elementi» sarebbe un'affermazione diversa.",
    inputs: [
      {
        entity: "SprintScopeEvent",
        reads: "ingressi e uscite di elementi dallo sprint, con l'istante e il verso",
      },
      {
        entity: "Sprint",
        reads: "l'istante di chiusura, e in sua assenza la data di fine pianificata",
      },
    ],
    observation: {
      kind: "at",
      instant:
        "l'istante di chiusura dello sprint, oppure l'istante di riferimento se lo sprint è ancora aperto",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "quante variazioni di perimetro sono state lette, non quanti elementi risultano dentro",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "Dello sprint non risulta alcuna variazione di perimetro.",
        outcome: "Nessun valore, con motivo «no-data»: non un conteggio di zero.",
        verifiedBy: "senza variazioni di perimetro non risponde zero, dice che non lo sa",
      },
      {
        situation: "Gli elementi sono entrati e poi tutti usciti prima del conteggio.",
        outcome: "Zero, questa volta misurato davvero.",
        verifiedBy: "uno sprint svuotato è uno zero misurato, non una lacuna",
      },
      {
        situation: "Lo sprint è ancora aperto e la sua data di fine è nel futuro.",
        outcome:
          "Si conta fino all'istante di riferimento, ignorando gli ingressi successivi.",
        verifiedBy: "uno sprint ancora in corso si ferma a adesso, non alla data di fine",
      },
    ],
    decision:
      "Il conteggio viene dalla storia del perimetro e non dal campo che lega l'elemento allo sprint: quel campo dice dove l'elemento si trova adesso, quindi ogni elemento trascinato in avanti farebbe rimpicciolire uno sprint già chiuso.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "sprintItemCount",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "burndown",
    name: "Burndown",
    question: "Giorno per giorno, quanto lavoro restava aperto nello sprint?",
    formula:
      "Un campione per ogni giorno lavorativo, preso all'ora di inizio dello sprint, di quanto lavoro risultava ancora aperto in quell'istante. Ogni elemento è pesato con la stima che aveva quel giorno.",
    unit: "points",
    excludes: [
      "Gli elementi conclusi e quelli annullati, che è esattamente ciò che fa scendere la linea.",
      "I giorni non lavorativi: sabati, domeniche e festività del progetto non compaiono sull'asse.",
      "Nessun elemento entrato a metà sprint viene ignorato: la composizione è ricalcolata a ogni campione, ed è per questo che la linea può salire.",
    ],
    unavailableWhen:
      "Lo sprint non contiene nemmeno un giorno lavorativo prima dell'istante di riferimento.",
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di inizio e la data di fine, che delimitano l'arco campionato",
      },
      {
        entity: "WorkingCalendar",
        reads:
          "quali giorni della settimana il progetto lavora e quali festività ha dichiarato",
      },
      {
        entity: "SprintScopeEvent",
        reads:
          "gli ingressi e le uscite, ricalcolati a ogni campione: è ciò che permette alla linea di salire",
      },
      {
        entity: "StateTransition",
        reads: "lo stato di ciascun elemento nell'istante del campione",
      },
      {
        entity: "EstimateChange",
        reads: "la stima che ciascun elemento aveva nell'istante del campione",
      },
      {
        entity: "WorkItem",
        reads:
          "la stima corrente, usata solo per gli elementi di cui la fonte non espone la storia delle stime",
      },
    ],
    observation: {
      kind: "history",
      over:
        "dall'inizio dello sprint fino alla sua fine pianificata o all'istante di riferimento, quello che viene prima, un campione ogni ventiquattro ore a partire dall'ora di inizio, saltando i giorni non lavorativi",
    },
    operation: "series",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti campioni compongono la linea, cioè quanti giorni lavorativi copre",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "Lo sprint attraversa un fine settimana.",
        outcome:
          "Sabato e domenica non compaiono: una linea piatta nel fine settimana sembrerebbe lavoro fermo.",
        verifiedBy: "saltando il fine settimana",
      },
      {
        situation: "Il progetto dichiara una festività dentro lo sprint.",
        outcome: "Quel giorno non compare: un ponte non è un giorno di lavoro fermo.",
        verifiedBy: "rispetta le festività dichiarate dal progetto",
      },
      {
        situation: "Del lavoro entra nello sprint dopo l'inizio.",
        outcome: "La linea sale: la composizione è ricalcolata a ogni campione.",
        verifiedBy: "la linea sale quando arriva lavoro a metà sprint",
      },
      {
        situation: "Una stima viene corretta a metà sprint.",
        outcome:
          "I campioni successivi usano la stima nuova: il burndown è la risposta corrente del team a «quanto manca», e una ri-stima ne fa parte.",
        verifiedBy: "usa la stima del giorno, non quella corrente",
      },
      {
        situation: "Lo sprint dura un solo giorno.",
        outcome:
          "Un punto, non zero punti: l'estremo iniziale è sempre campionato se è lavorativo. La linea ideale però non c'è, perché non ha una pendenza.",
        verifiedBy: "gestisce uno sprint di un solo giorno",
      },
      {
        situation: "Lo sprint è ancora in corso.",
        outcome:
          "La linea si ferma a oggi invece di proseguire piatta fino alla data di fine, che sembrerebbe lavoro fermo. La linea ideale arriva comunque all'ultimo giorno.",
        verifiedBy: "si ferma a oggi invece di disegnare i giorni non ancora avvenuti",
      },
    ],
    decision:
      "I giorni non lavorativi si saltano. Kniberg racconta di averli inclusi e poi tolti: la linea si appiattiva nel fine settimana «which would look like a warning sign». Un grafico che inventa allarmi insegna a ignorare quelli veri.",
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
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia di ogni elemento, per trovare il primo ingresso in «concluso» e vedere se cade nell'intervallo",
      },
    ],
    observation: {
      kind: "between",
      from: "l'inizio dell'intervallo richiesto",
      to: "la fine dell'intervallo richiesto",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi distinti hanno una storia di stati nell'insieme esaminato, non quanti sono stati conclusi",
    referenceInstant: "parametri from e to, che delimitano la finestra",
    edgeCases: [
      {
        situation: "Un elemento è stato concluso, riaperto e richiuso dentro la finestra.",
        outcome: "Contato una volta sola: vale il primo ingresso in «concluso».",
        verifiedBy: "conta una sola volta un elemento concluso più volte",
      },
      {
        situation: "La finestra è vuota o ha gli estremi invertiti.",
        outcome: "Nessun valore, con motivo «empty-denominator»: non un conteggio di zero.",
        verifiedBy: "non è disponibile su una finestra vuota o invertita",
      },
    ],
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
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia di ogni elemento, per stabilire in quale stato si trovava nell'istante richiesto",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante richiesto, passato dal chiamante",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi distinti hanno una storia di stati, cioè su quanti è stato possibile guardare — non quanti risultano in lavorazione",
    referenceInstant: "parametro instant",
    edgeCases: [
      {
        situation: "Un elemento è bloccato.",
        outcome: "Non è contato: lavoro che nessuno può muovere non è lavoro in corso.",
        verifiedBy: "non conta gli elementi bloccati",
      },
      {
        situation: "Si chiede il lavoro in corso a un istante passato.",
        outcome: "Si guarda lo stato di allora, non l'ultimo stato noto.",
        verifiedBy: "misura l'istante richiesto, non l'ultimo stato",
      },
      {
        situation: "Non risulta alcuna storia di stati.",
        outcome: "Nessun valore, con motivo «no-data»: non zero elementi in lavorazione.",
        verifiedBy: "non è disponibile senza dati",
      },
    ],
    decision:
      "Questione Q2, ancora aperta: escludere i bloccati lascia sembrare libero un team che in realtà ha del lavoro fermo fra le mani. La scelta attuale è dichiarata, non implicita.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "workInProgress",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "items-by-state",
    name: "Elementi per stato",
    question: "Quanti elementi si trovano in ciascuno stato del flusso in questo momento?",
    formula:
      "Per ogni elemento si stabilisce in quale stato si trovava nell'istante richiesto, e si contano gli elementi stato per stato.",
    unit: "count",
    excludes: [
      "La distinzione fra due colonne che rappresentano lo stesso stato: la storia registra lo stato, non la colonna, e dividerli sarebbe un'invenzione.",
      "Gli elementi di cui non risulta alcuna transizione: non si sa dove siano, e collocarli in «da fare» sarebbe una supposizione.",
    ],
    unavailableWhen:
      "Non esiste alcuna storia di stati: una bacheca tutta a zero affermerebbe che le colonne sono vuote, che è diverso dal non saperlo.",
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia di ogni elemento, per stabilire in quale stato si trovava nell'istante richiesto",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante richiesto, passato dal chiamante",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "su quanti elementi distinti è stato possibile guardare, cioè quanti hanno una storia di stati",
    referenceInstant: "parametro instant",
    edgeCases: [
      {
        situation: "Uno stato non contiene alcun elemento.",
        outcome: "Compare comunque, con il valore zero, invece di essere omesso.",
        verifiedBy: "dichiara zero per gli stati vuoti, invece di ometterli",
      },
      {
        situation: "Si chiede la situazione a un istante passato.",
        outcome: "Si guarda lo stato di allora, non l'ultimo stato noto.",
        verifiedBy: "guarda l'istante richiesto, non l'ultimo stato conosciuto",
      },
      {
        situation: "Non risulta alcuna storia di stati.",
        outcome: "Nessun valore, con motivo «no-data»: non una bacheca vuota.",
        verifiedBy: "non è disponibile senza storia degli stati",
      },
    ],
    decision:
      "Il conteggio è per stato e non per colonna. Più colonne possono rappresentare lo stesso stato — «in revisione» e «in attesa di collaudo» sono entrambe in_review — e la storia non registra in quale delle due l'elemento si trovasse: un conteggio per colonna dovrebbe inventarsi la ripartizione.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "workItemsByState",
    testFile: "tests/metrics/sprint.test.ts",
  },
  {
    id: "sprint-health",
    name: "Salute dello sprint",
    question: "Lo sprint aperto sta andando come dovrebbe, o c'è qualcosa da guardare adesso?",
    formula:
      "Si valutano cinque segnali — avanzamento contro tempo trascorso, lavoro aggiunto dopo l'inizio, attesa in revisione rispetto agli sprint conclusi, occupazione delle colonne rispetto al limite dichiarato, quota di elementi fermi oltre l'abitudine del progetto — ciascuno contro due soglie scritte. Il giudizio complessivo è il peggiore dei cinque.",
    unit: "verdict",
    excludes: [
      "Qualsiasi valutazione delle persone: i segnali riguardano code, attese e perimetro, che sono fatti del processo.",
      "Gli sprint chiusi: la domanda è cosa si può ancora cambiare, e su uno sprint concluso quella domanda non esiste più. Per quelli c'è il resoconto.",
      "La media dei segnali, che nasconderebbe un problema grave sotto tre indicatori sereni.",
      "Le soglie configurabili dall'interfaccia: finché non sono tarate su dati veri, poterle cambiare senza argomentarle le trasformerebbe in preferenze.",
    ],
    unavailableWhen:
      "Lo sprint non è ancora cominciato, è già finito, oppure ha date incoerenti. Un giudizio su uno sprint che non è in corso non è prudente, è sbagliato.",
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di inizio e la data di fine, da cui la frazione di tempo trascorso",
      },
      {
        entity: "SprintScopeEvent",
        reads: "l'impegno iniziale e ciò che è entrato dopo l'inizio",
      },
      {
        entity: "StateTransition",
        reads:
          "la storia degli stati, da cui avanzamento, attesa in revisione, occupazione delle colonne ed elementi fermi",
      },
      {
        entity: "WorkItem",
        reads: "le stime, quando ci sono: senza, l'avanzamento si misura sui conteggi",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di riferimento, che deve cadere dentro lo sprint",
    },
    operation: "worst",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti dei cinque segnali è stato possibile valutare: un giudizio che poggia su un solo segnale merita molta meno fiducia di uno che ne ha cinque",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "Nessuno dei cinque segnali è valutabile.",
        outcome:
          "Il giudizio è «non valutabile», mai «sereno»: un verde che significa «non ho potuto guardare» viene creduto.",
        verifiedBy: "senza alcun segnale valutabile dice «non valutabile», mai «sereno»",
      },
      {
        situation: "Un segnale è critico e gli altri quattro sono sereni.",
        outcome: "Il giudizio è critico: è il peggiore, non la media.",
        verifiedBy: "un solo segnale critico rende critico il giudizio",
      },
      {
        situation: "Lo sprint è cominciato da poche ore.",
        outcome:
          "L'avanzamento non è valutabile: essere all'8% il primo giorno non significa nulla.",
        verifiedBy: "non si pronuncia su uno sprint appena cominciato",
      },
      {
        situation: "Gli elementi sono stimati in unità diverse.",
        outcome: "L'avanzamento non è valutabile: punti e ore non si sommano.",
        verifiedBy: "non è valutabile se le stime sono in unità diverse",
      },
      {
        situation: "Nessuna colonna dichiara un limite di lavoro in corso.",
        outcome:
          "Il segnale è non valutabile, non «rispettato»: non si sostituisce con una soglia inventata.",
        verifiedBy: "non è valutabile quando nessuna colonna dichiara un limite",
      },
      {
        situation: "Lo sprint finisce oggi.",
        outcome: "Valutabile: la frazione trascorsa è il 100%, mai oltre.",
        verifiedBy: "si ferma al 100% il giorno in cui lo sprint finisce, non oltre",
      },
    ],
    decision:
      "Il giudizio è calcolato in codice e nessun modello linguistico lo tocca (R1). Un colore prodotto da un modello sarebbe irripetibile, non discutibile e impossibile da confrontare con i numeri che ha accanto; il modello può raccontarlo, non deciderlo.",
    sourceFile: "src/metrics/health.ts",
    sourceSymbol: "sprintHealth",
    testFile: "tests/metrics/health.test.ts",
  },
  {
    id: "bottleneck",
    name: "Dove si accumula il tempo",
    question: "Fra la presa in carico e la chiusura, in quale fase il lavoro resta fermo più a lungo?",
    formula:
      "La storia di ogni elemento viene scomposta nei tratti passati in ciascuno stato, dal primo ingresso in «in lavorazione» alla prima chiusura. I tratti si sommano per stato, e ogni fase riceve la propria quota sul tempo totale misurato.",
    unit: "ratio",
    excludes: [
      "L'attesa in backlog, prima che il lavoro sia preso in carico: è una scelta di priorità, non un ingolfamento del flusso. Includerla farebbe risultare «da fare» il collo di bottiglia di quasi ogni progetto — vero e inutile.",
      "Il tempo dopo la chiusura: un elemento concluso non attraversa più fasi, e contarlo misurerebbe da quanto è finito.",
      "Gli elementi mai presi in carico: di loro non esiste un flusso da misurare.",
      "Le fasi in cui qualcuno lavora, quando si sceglie il collo di bottiglia: chiamare così la lavorazione significherebbe dire alla squadra che l'ostacolo a finire il lavoro è farlo.",
    ],
    unavailableWhen:
      "Nessun elemento è mai entrato in lavorazione, oppure tutto il tempo misurato è di durata nulla: «non è mai partito nulla» e «tutto è stato istantaneo» sono affermazioni diverse.",
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia degli stati di ogni elemento, scomposta nei tratti passati in ciascuno stato",
      },
    ],
    observation: {
      kind: "between",
      from: "il primo ingresso in «in lavorazione»",
      to: "la prima chiusura, oppure l'istante di riferimento se l'elemento è ancora aperto",
    },
    operation: "ratio",
    summarisedBy: ["median"],
    sampleSizeMeaning:
      "quanti elementi sono stati presi in carico almeno una volta, cioè su quanti la misura poggia — non quanti ne esistono",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "La lavorazione è la fase che assorbe più tempo in assoluto.",
        outcome:
          "Viene mostrata come tale, ma il collo di bottiglia resta la maggiore fra le fasi di attesa.",
        verifiedBy: "non nomina mai come collo di bottiglia una fase di lavorazione",
      },
      {
        situation: "Non risulta alcuna attesa: il tempo è tutto lavorazione.",
        outcome:
          "Nessun collo di bottiglia viene nominato: eleggere il male minore a problema rende una diagnosi che nessuno legge più.",
        verifiedBy: "senza alcuna attesa non nomina alcun collo di bottiglia",
      },
      {
        situation: "Un elemento ha atteso a lungo in backlog prima di essere preso in carico.",
        outcome: "Quel tempo resta fuori dalla misura (questione Q1).",
        verifiedBy: "lascia fuori l'attesa prima della presa in carico",
      },
      {
        situation: "Un elemento è ancora fermo in una fase in questo momento.",
        outcome: "Il tratto in corso conta fino all'istante di riferimento.",
        verifiedBy: "conta il tratto ancora in corso fino all'istante di riferimento",
      },
      {
        situation: "Nessun elemento è mai stato preso in carico.",
        outcome: "Nessun valore, con motivo «no-qualifying-data».",
        verifiedBy: "non è disponibile se nessun elemento è mai stato preso in carico",
      },
    ],
    decision:
      "Nessuna soglia decide se una fase «conti» come collo di bottiglia (questione Q2, ancora aperta): la quota viaggia accanto al nome, così chi legge giudica se il 34% sia un ingolfamento o una distribuzione normale. Una soglia inventata nasconderebbe il dubbio invece di risolverlo.",
    sourceFile: "src/metrics/bottleneck.ts",
    sourceSymbol: "bottleneck",
    testFile: "tests/metrics/bottleneck.test.ts",
  },
  {
    id: "daily-activity",
    name: "Attività di una giornata",
    question:
      "In una giornata, che cosa si è mosso, che cosa è tornato indietro e che cosa è rimasto fermo?",
    formula:
      "Si contano le transizioni cadute dentro la finestra e si classificano: gli ingressi in «concluso» sono lavoro finito, il primo ingresso in «in lavorazione» è lavoro iniziato, le uscite da «concluso» sono riaperture. A fine finestra si guarda lo stato di ogni elemento: quelli in «bloccato» si elencano, e quelli non terminali la cui ultima transizione è più vecchia della soglia ricevuta risultano fermi.",
    unit: "count",
    excludes: [
      "Il ritorno in lavorazione dopo una revisione, che è movimento ma non è un inizio: contarlo gonfierebbe il digest proprio nei giorni di rilavorazione, quando un resoconto ottimista inganna di più.",
      "Gli elementi conclusi, quando si cerca ciò che è fermo: un elemento chiuso da un mese non è fermo, è finito.",
      "Qualsiasi attribuzione a una persona: si contano gli elementi e i loro passaggi, mai chi li ha fatti.",
      "La definizione di «ieri»: dove cominci un giorno dipende dal fuso di chi guarda, e deciderlo qui farebbe raccontare fatti diversi a due persone sullo stesso progetto.",
    ],
    unavailableWhen:
      "Non esiste alcuna storia degli stati, oppure la finestra richiesta finisce prima di cominciare. Una giornata senza movimenti resta invece disponibile, con le liste vuote: «ieri non si è mosso nulla» è l'informazione più preoccupante che questa metrica possa dare, e trasformarla in «non disponibile» la cancellerebbe.",
    inputs: [
      {
        entity: "StateTransition",
        reads:
          "la storia degli stati, da cui i passaggi caduti nella finestra e lo stato di ciascun elemento alla sua fine",
      },
    ],
    observation: {
      kind: "between",
      from: "l'inizio della finestra, passato dal chiamante",
      to: "la fine della finestra, passata dal chiamante",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning:
      "quanti elementi distinti hanno una storia di stati, cioè su quanti la giornata è stata osservabile",
    referenceInstant: "parametri from e to",
    edgeCases: [
      {
        situation: "Nella finestra non cade alcuna transizione.",
        outcome:
          "La metrica è disponibile con le liste vuote: «non si è mosso nulla» è un fatto, non un dato mancante.",
        verifiedBy: "un giorno senza movimenti è un fatto, non un'assenza di dati",
      },
      {
        situation: "Un elemento rientra in lavorazione dopo una revisione.",
        outcome: "Conta come movimento, non come lavoro iniziato.",
        verifiedBy: "considera «iniziato» solo il primo ingresso in lavorazione",
      },
      {
        situation: "Un elemento esce da «concluso».",
        outcome: "È una riapertura, tenuta distinta da ciò che è stato completato.",
        verifiedBy: "registra una riapertura come tale, non come avanzamento",
      },
      {
        situation: "Un elemento cambia stato dopo la fine della finestra.",
        outcome: "Si guarda lo stato che aveva alla fine della finestra, non l'ultimo noto.",
        verifiedBy: "guarda lo stato alla fine della finestra, non l'ultimo conosciuto",
      },
      {
        situation: "Non viene passata alcuna soglia di immobilità.",
        outcome: "L'elenco dei fermi resta vuoto, invece di adottare una soglia inventata.",
        verifiedBy: "senza una soglia non inventa una definizione di «troppo»",
      },
      {
        situation: "Non esiste alcuna storia degli stati.",
        outcome: "Nessun valore, con motivo «no-data».",
        verifiedBy: "non è disponibile senza alcuna storia degli stati",
      },
    ],
    decision:
      "La finestra è un parametro e non «ieri» calcolato qui dentro. Il motore non legge l'orologio (ADR-0002), e il confine di una giornata dipende dal fuso di chi guarda: deciderlo nel calcolo produrrebbe due verità diverse sullo stesso progetto, entrambe apparentemente affidabili.",
    sourceFile: "src/metrics/daily.ts",
    sourceSymbol: "dailyActivity",
    testFile: "tests/metrics/daily.test.ts",
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
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di inizio e la data di fine di ciascuno sprint passato",
      },
    ],
    observation: {
      kind: "between",
      from: "l'inizio di ciascuno sprint",
      to: "la fine pianificata dello stesso sprint",
    },
    operation: "median",
    summarisedBy: ["median"],
    sampleSizeMeaning:
      "quanti sprint hanno una durata utilizzabile: quelli con date incoerenti non entrano nel conto, quindi il campione può essere più piccolo dell'elenco ricevuto",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Il progetto ha un solo sprint.",
        outcome: "Nessun valore, con motivo «no-qualifying-data»: uno solo non è un'abitudine.",
        verifiedBy: "non è disponibile con un solo sprint",
      },
      {
        situation: "Uno sprint ha date incoerenti e finisce prima di iniziare.",
        outcome: "Escluso dal calcolo, invece di essere appiattito a zero giorni.",
        verifiedBy: "esclude uno sprint che finisce prima di iniziare, invece di appiattirlo a zero",
      },
      {
        situation: "Le durate osservate sono più corte di mezza giornata.",
        outcome: "Si propone comunque almeno un giorno, mai zero.",
        verifiedBy: "propone almeno un giorno, mai zero",
      },
    ],
    decision:
      "La mediana e non la media: uno sprint accorciato da una festività trascinerebbe una media lontano dalla durata a cui il team lavora davvero.",
    sourceFile: "src/metrics/sprint.ts",
    sourceSymbol: "typicalSprintLengthDays",
    testFile: "tests/metrics/sprint-length.test.ts",
  },
  {
    id: "available-man-days",
    name: "Giorni-uomo disponibili",
    question: "Quanta capacità ha la squadra in questo sprint?",
    formula:
      "Per ciascuna persona: giorni lavorativi dello sprint × quota di allocazione, meno i giorni di assenza. Sommato su tutta la squadra.",
    unit: "count",
    excludes: [
      "I giorni non lavorativi: tre settimane di calendario sono quindici giorni, non ventuno.",
      "I contributi negativi: chi è assente più giorni di quanti ne lavorerebbe conta zero, non meno di zero, altrimenti cancellerebbe i giorni veri di un collega.",
      "Le disponibilità dichiarate per un altro sprint.",
    ],
    unavailableWhen:
      "Nessuno ha dichiarato la propria disponibilità per questo sprint: è diverso da una capacità di zero.",
    inputs: [
      {
        entity: "Sprint",
        reads: "le date di inizio e fine, che delimitano i giorni da contare",
      },
      {
        entity: "WorkingCalendar",
        reads: "quali giorni della settimana il progetto lavora e quali festività ha dichiarato",
      },
      {
        entity: "TeamMemberAvailability",
        reads: "la quota di allocazione e i giorni di assenza di ciascuna persona",
      },
    ],
    observation: {
      kind: "between",
      from: "l'inizio dello sprint",
      to: "la fine pianificata dello sprint",
    },
    operation: "sum",
    summarisedBy: [],
    sampleSizeMeaning: "quante persone hanno una disponibilità dichiarata per questo sprint",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Una persona è a metà tempo e assente un giorno.",
        outcome:
          "L'assenza si sottrae dopo l'allocazione: su quindici giorni fa 6,5 e non 7. Un giorno di assenza è un giorno intero tolto dal piano.",
        verifiedBy: "sottrae le assenze dopo l'allocazione, non prima",
      },
      {
        situation: "Lo sprint dura tre settimane di calendario.",
        outcome: "Conta quindici giorni lavorativi, non ventuno.",
        verifiedBy: "conta i giorni lavorativi, non quelli di calendario",
      },
      {
        situation: "Una persona è assente per tutto lo sprint.",
        outcome: "Contribuisce zero, mai un valore negativo che toglierebbe giorni ai colleghi.",
        verifiedBy: "una persona interamente assente non toglie giorni ai colleghi",
      },
      {
        situation: "Nessuna disponibilità è stata dichiarata.",
        outcome: "Nessun valore, con motivo «no-data»: non una capacità di zero.",
        verifiedBy: "senza disponibilità dichiarate non risponde zero, dice che non lo sa",
      },
    ],
    decision:
      "Esiste solo come totale di squadra, e non esisterà mai una variante per persona: §8.2 vieta le metriche di rendimento individuale, e la strada più breve per produrne una è una funzione che accetta una persona e restituisce giorni.",
    sourceFile: "src/metrics/planning.ts",
    sourceSymbol: "availableManDays",
    testFile: "tests/metrics/planning.test.ts",
  },
  {
    id: "focus-factor",
    name: "Focus factor",
    question: "Quanta parte del tempo della squadra è finita nel lavoro impegnato?",
    formula: "Velocity effettiva dello sprint ÷ giorni-uomo disponibili.",
    unit: "ratio",
    excludes: [
      "Gli sprint con stime in unità diverse: punti e ore divisi per giorni sono due scale incompatibili.",
      "Gli sprint stimati in sole ore: la domanda non si applica, perché il rapporto ha senso solo trattando un punto come un giorno-uomo ideale.",
    ],
    unavailableWhen:
      "La capacità è zero o non dichiarata, oppure la velocity non è calcolabile in punti.",
    inputs: [
      {
        entity: "TeamMemberAvailability",
        reads: "la capacità della squadra, che è il denominatore",
      },
      {
        entity: "Sprint",
        reads: "le date, per contare i giorni lavorativi",
      },
      {
        entity: "SprintScopeEvent",
        reads: "cosa conteneva lo sprint alla chiusura",
      },
      {
        entity: "StateTransition",
        reads: "chi risultava concluso alla chiusura",
      },
      {
        entity: "EstimateChange",
        reads: "la stima d'ingresso di ciascun elemento concluso",
      },
      {
        entity: "WorkItem",
        reads: "la stima corrente, per gli elementi privi di storia",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di chiusura dello sprint",
    },
    operation: "ratio",
    summarisedBy: [],
    sampleSizeMeaning: "quanti elementi conclusi hanno contribuito alla velocity al numeratore",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Lo sprint mescola stime in punti e in ore.",
        outcome: "Nessun valore, con motivo «mixed-estimate-units», invece di un numero plausibile.",
        verifiedBy: "non è calcolabile con unità di stima miste",
      },
      {
        situation: "La squadra chiude più punti dei giorni-uomo disponibili.",
        outcome:
          "Il valore supera 1 e non viene limitato: sarebbe proprio il segnale che invita a guardare le stime.",
        verifiedBy: "non viene limitato a uno quando la squadra supera la propria capacità",
      },
      {
        situation: "La capacità dichiarata è zero.",
        outcome: "Nessun valore, con motivo «empty-denominator»: mai una divisione per zero.",
        verifiedBy: "una capacità di zero non produce una divisione per zero",
      },
    ],
    decision:
      "L'autore del libro ritratta questa formula — «I never use focus factor any more… it gives a false sense of accuracy» — quindi resta calcolabile ma non è il metodo predefinito, e ovunque compaia va mostrata insieme alla ritrattazione (ADR-0008).",
    sourceFile: "src/metrics/planning.ts",
    sourceSymbol: "focusFactor",
    testFile: "tests/metrics/planning.test.ts",
  },
  {
    id: "estimated-velocity",
    name: "Velocity stimata",
    question: "Quanto lavoro la squadra prevede di chiudere in questo sprint?",
    formula:
      "Con «meteo di ieri»: media della velocity effettiva degli ultimi sprint conclusi. Con il focus factor: giorni-uomo disponibili × focus factor dell'ultimo sprint chiuso. Per un team senza storia: giorni-uomo disponibili × 70%.",
    unit: "points",
    excludes: [
      "Lo sprint ancora in corso, che non ha finito di consegnare: mediarne il parziale abbasserebbe ogni previsione per un motivo che dipende solo da quando si è posta la domanda.",
      "Gli sprint conclusi dopo l'inizio di quello che si sta prevedendo.",
    ],
    unavailableWhen:
      "Il metodo scelto non ha i dati che gli servono. Non si ripiega in silenzio su un altro metodo.",
    inputs: [
      {
        entity: "Sprint",
        reads: "gli sprint conclusi e le loro date",
      },
      {
        entity: "TeamMemberAvailability",
        reads: "la capacità, quando il metodo scelto la usa",
      },
      {
        entity: "SprintScopeEvent",
        reads: "cosa conteneva ciascuno sprint concluso",
      },
      {
        entity: "StateTransition",
        reads: "cosa risultava concluso alla chiusura di ciascuno",
      },
      {
        entity: "EstimateChange",
        reads: "le stime d'ingresso su cui si calcola la velocity passata",
      },
      {
        entity: "WorkItem",
        reads: "la stima corrente, per gli elementi privi di storia",
      },
    ],
    observation: {
      kind: "history",
      over: "gli sprint conclusi prima dell'inizio di quello da prevedere",
    },
    operation: "mean",
    summarisedBy: ["mean"],
    sampleSizeMeaning: "su quanti sprint conclusi poggia la previsione",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Il progetto ha uno sprint aperto e uno concluso.",
        outcome: "Conta solo quello concluso: l'aperto non ha finito di consegnare.",
        verifiedBy: "ignora lo sprint ancora in corso",
      },
      {
        situation: "Il team è nuovo e non ha alcuno sprint concluso.",
        outcome:
          "Con il metodo di ripiego si usa il 70% che il libro indica per i team nuovi, e il metodo viene dichiarato.",
        verifiedBy: "per un team nuovo ripiega sul 70% dichiarato dal libro",
      },
      {
        situation: "Si chiede il focus factor ma nessuno ha dichiarato la capacità.",
        outcome:
          "Nessun valore, con il motivo del metodo richiesto: non si cambia metodo di nascosto.",
        verifiedBy: "un metodo senza dati dichiara il proprio motivo invece di cambiare metodo",
      },
    ],
    decision:
      "Il metodo è un parametro esplicito e viene sempre dichiarato insieme al numero. Una previsione che cambia metodo da uno sprint all'altro cambia significato senza dirlo, e nessuno può contestarla perché nessuno sa cosa afferma.",
    sourceFile: "src/metrics/planning.ts",
    sourceSymbol: "estimatedVelocity",
    testFile: "tests/metrics/planning.test.ts",
  },
  {
    id: "committed-velocity",
    name: "Velocity impegnata",
    question: "Quanto lavoro conteneva il piano all'inizio dello sprint?",
    formula:
      "Somma delle stime d'ingresso degli elementi presenti nello sprint nell'istante in cui è cominciato.",
    unit: "points",
    excludes: [
      "Il lavoro entrato dopo l'inizio: è una variazione di perimetro, e c'è una metrica che lo dice.",
      "Il bersaglio della previsione: contano le storie effettivamente scelte, non il numero a cui si mirava.",
    ],
    unavailableWhen:
      "Lo sprint non conteneva nulla all'inizio, o nessun elemento aveva una stima.",
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di inizio",
      },
      {
        entity: "SprintScopeEvent",
        reads: "cosa era già dentro all'inizio e quando ciascun elemento è entrato",
      },
      {
        entity: "EstimateChange",
        reads: "la stima che ciascun elemento aveva all'ingresso",
      },
      {
        entity: "WorkItem",
        reads: "la stima corrente, per gli elementi privi di storia",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di inizio dello sprint",
    },
    operation: "sum",
    summarisedBy: [],
    sampleSizeMeaning: "quanti elementi c'erano nel piano iniziale",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "La squadra mirava a 20 punti e ha scelto quattro storie da 19.",
        outcome: "Il piano è 19: si misura lo sprint contro ciò che si è preso, non contro il bersaglio.",
        verifiedBy: "somma le storie scelte, non il bersaglio",
      },
      {
        situation: "Del lavoro entra dopo l'inizio.",
        outcome: "Non entra nel conto: farebbe sembrare che la squadra si fosse impegnata su qualcosa che ancora non esisteva.",
        verifiedBy: "non conta il lavoro entrato dopo l'inizio",
      },
      {
        situation: "Nessun elemento del piano ha una stima.",
        outcome: "Nessun valore, con motivo «no-qualifying-data»: non un piano da zero punti.",
        verifiedBy: "uno sprint senza stime dichiara la lacuna invece di rispondere zero",
      },
    ],
    decision:
      "Distinta dalla velocity stimata perché il libro le distingue: il bersaglio era 20, le quattro storie scelte fanno 19, e 19 è il piano. Misurare lo sprint contro il bersaglio significherebbe confrontarlo con un numero che nessuno si è preso.",
    sourceFile: "src/metrics/planning.ts",
    sourceSymbol: "committedVelocity",
    testFile: "tests/metrics/planning.test.ts",
  },
  {
    id: "forecast-variance",
    name: "Scostamento dalla previsione",
    question: "Di quanto lo sprint si è discostato da ciò che era previsto?",
    formula: "Velocity effettiva meno velocity prevista, in punti.",
    unit: "points",
    excludes: [
      "Gli sprint con stime in unità miste, che non hanno una velocity in punti da confrontare.",
    ],
    unavailableWhen: "La velocity effettiva non è calcolabile in punti.",
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di chiusura, tramite la velocity effettiva",
      },
      {
        entity: "SprintScopeEvent",
        reads: "cosa conteneva lo sprint alla chiusura",
      },
      {
        entity: "StateTransition",
        reads: "cosa risultava concluso a quell'istante",
      },
      {
        entity: "EstimateChange",
        reads: "le stime d'ingresso degli elementi conclusi",
      },
      {
        entity: "WorkItem",
        reads: "la stima corrente, per gli elementi privi di storia",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di chiusura dello sprint",
    },
    operation: "sum",
    summarisedBy: [],
    sampleSizeMeaning: "quanti elementi conclusi hanno contribuito alla velocity effettiva",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Si è consegnato meno del previsto.",
        outcome: "Valore negativo, con il segno che dice la direzione.",
        verifiedBy: "è negativo quando si consegna meno del previsto",
      },      {
        situation: "Si è consegnato più del previsto.",
        outcome: "Valore positivo.",
        verifiedBy: "è positivo quando si consegna di più",
      },
      {
        situation: "Lo sprint non ha una velocity calcolabile.",
        outcome: "Nessuno scostamento, invece di uno inventato contro zero.",
        verifiedBy: "senza velocity effettiva non inventa uno scostamento",
      },
    ],
    decision:
      "Una differenza con segno e non un rapporto: un rapporto nasconde la dimensione dello sprint che descrive, e sbagliare di tre punti su cinque è una situazione diversa dallo sbagliare di tre su cinquanta.",
    sourceFile: "src/metrics/planning.ts",
    sourceSymbol: "forecastVariance",
    testFile: "tests/metrics/planning.test.ts",
  },
  {
    id: "estimation-scale-conformance",
    name: "Stime fuori scala",
    question: "Quante stime non stanno sulla scala che la squadra ha dichiarato?",
    formula:
      "Conteggio delle stime in punti che non compaiono fra i valori ammessi dalla scala del progetto, sul totale delle stime in punti.",
    unit: "count",
    excludes: [
      "Gli elementi senza stima: non c'è nulla da confrontare con la scala, e contarli renderebbe la conformità dipendente da quanti spike contiene lo sprint.",
      "Le stime in ore: il mazzo del planning poker misura dimensioni, non durate, e i suoi salti non hanno significato su un'ora.",
      "Chi ha proposto la stima: nel libro stimare è un'attività di squadra (§8.2).",
    ],
    unavailableWhen: "Il progetto non ha dichiarato una scala.",
    inputs: [
      {
        entity: "WorkItem",
        reads: "la stima corrente, con la sua unità",
      },
    ],
    observation: {
      kind: "at",
      instant: "la stima corrente, così come la fonte l'ha riportata",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning: "quante stime in punti la scala ha potuto giudicare",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Il progetto non ha dichiarato una scala.",
        outcome: "Nessuna deviazione, invece di inventare una regola che nessuno ha adottato.",
        verifiedBy: "senza scala dichiarata non riporta alcuna deviazione",
      },
      {
        situation: "Una stima vale 7, e la scala è il planning poker.",
        outcome: "Fuori scala, con i due valori ammessi fra cui sta: 5 e 8.",
        verifiedBy: "un 7 sul planning poker viene segnalato fra 5 e 8",
      },
      {
        situation: "Una stima supera la carta più grande del mazzo.",
        outcome: "Fuori scala, ma senza valori vicini: sopra 100 non c'è nulla da nominare.",
        verifiedBy: "sopra la carta più grande non inventa un valore superiore",
      },
      {
        situation: "Lo stesso numero è ammesso da una scala e non dall'altra.",
        outcome:
          "Un 20 sta sul planning poker e non sulla Fibonacci stretta: sono due scale, non una con tolleranza.",
        verifiedBy: "il 20 sta sul planning poker ma non sulla Fibonacci",
      },
      {
        situation: "Una stima vale mezzo punto.",
        outcome: "Ammessa dal planning poker: è la carta più piccola del mazzo.",
        verifiedBy: "il mezzo punto è la carta più piccola e viene ammesso",
      },
    ],
    decision:
      "Segnala, non rifiuta. Le stime arrivano da una fonte esterna e il contenuto ingerito è dato, mai istruzione (R3): rifiutare l'importazione di una storia da 7 punti farebbe perdere la storia, non correggerebbe la stima.",
    sourceFile: "src/metrics/estimation.ts",
    sourceSymbol: "estimationScaleConformance",
    testFile: "tests/metrics/estimation.test.ts",
  },
  {
    id: "improvement-follow-up",
    name: "Seguito dei miglioramenti",
    question: "I miglioramenti decisi in retrospettiva sono poi avvenuti?",
    formula:
      "Conteggio dei miglioramenti per stato, quota di quelli portati a termine sui considerati, e tempo trascorso da quando è stato deciso il più vecchio ancora aperto.",
    unit: "count",
    excludes: [
      "I miglioramenti lasciati cadere, esclusi dal denominatore: non agire è una scelta legittima, e contarli come fallimenti spingerebbe a dichiarare di aver fatto qualcosa.",
      "Chi ha proposto o chiuso un miglioramento: non è registrato da nessuna parte.",
    ],
    unavailableWhen: "Nessun miglioramento è mai stato deciso in una retrospettiva.",
    inputs: [
      {
        entity: "ImprovementAction",
        reads: "lo stato, l'istante in cui è stato deciso e quello in cui è stato risolto",
      },
    ],
    observation: {
      kind: "at",
      instant: "l'istante di riferimento passato dal chiamante",
    },
    operation: "count",
    summarisedBy: [],
    sampleSizeMeaning: "quanti miglioramenti sono stati decisi in tutto, in ogni stato",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "La squadra ha lasciato cadere ogni miglioramento deciso.",
        outcome:
          "Nessuna quota di completamento, invece di uno zero che la farebbe sembrare una squadra che ci ha provato e ha fallito.",
        verifiedBy: "senza nulla da considerare non riporta una quota di zero",
      },
      {
        situation: "Nessun miglioramento è ancora aperto.",
        outcome: "Nessuna anzianità, invece di zero.",
        verifiedBy: "senza nulla di aperto non inventa un'anzianità",
      },
      {
        situation: "Non è mai stato deciso alcun miglioramento.",
        outcome: "Nessun valore, con motivo «no-data».",
        verifiedBy: "senza alcun miglioramento dichiara la lacuna invece di rispondere zero",
      },
      {
        situation: "La stessa domanda viene posta in due istanti diversi.",
        outcome:
          "Due anzianità diverse, perché l'istante arriva dal chiamante e non dall'orologio.",
        verifiedBy: "non legge l'orologio: lo stesso insieme a due istanti dà due anzianità",
      },
    ],
    decision:
      "I lasciati cadere escono dal denominatore. Il libro ammette esplicitamente di decidere di non agire — «in many cases, just identifying a problem clearly is enough for it to solve itself» — e trattarli come fallimenti insegnerebbe a una squadra a chiudere per finta.",
    sourceFile: "src/metrics/retrospective.ts",
    sourceSymbol: "improvementFollowUp",
    testFile: "tests/metrics/retrospective.test.ts",
  },
  {
    id: "improvement-lead-time",
    name: "Tempo di un miglioramento",
    question: "Quanto ci mette questa squadra a portare a termine ciò che decide?",
    formula:
      "Media del tempo fra la decisione e la risoluzione, sui soli miglioramenti chiusi.",
    unit: "duration",
    excludes: [
      "I miglioramenti ancora aperti: contarli con i «giorni finora» mescolerebbe due misure diverse, e renderebbe una squadra più veloce quanto più lascia aperto.",
      "Le durate negative, cioè risolte prima di essere decise: sono un difetto della fonte.",
    ],
    unavailableWhen: "Nessun miglioramento è ancora stato chiuso.",
    inputs: [
      {
        entity: "ImprovementAction",
        reads: "l'istante in cui è stato deciso e quello in cui è stato risolto",
      },
    ],
    observation: {
      kind: "between",
      from: "l'istante in cui il miglioramento è stato deciso",
      to: "l'istante in cui è stato risolto",
    },
    operation: "mean",
    summarisedBy: ["mean"],
    sampleSizeMeaning: "quanti miglioramenti chiusi hanno una durata utilizzabile",
    referenceInstant: null,
    edgeCases: [
      {
        situation: "Ci sono miglioramenti aperti da molto tempo.",
        outcome: "Non entrano nella media: è una durata osservata, non una in corso.",
        verifiedBy: "media solo i miglioramenti chiusi",
      },
      {
        situation: "Nessun miglioramento è ancora stato chiuso.",
        outcome: "Nessun valore, con motivo «no-qualifying-data».",
        verifiedBy: "senza nulla di chiuso non inventa una durata",
      },
      {
        situation: "Un miglioramento risulta risolto prima di essere stato deciso.",
        outcome: "Scartato, invece di mediare una durata negativa.",
        verifiedBy: "scarta una durata negativa invece di mediarla",
      },
    ],
    decision:
      "La media e non la mediana: i miglioramenti per sprint sono pochi — il libro dice di sceglierne pochissimi — e su cinque valori la mediana butta via più informazione di quanta ne protegga.",
    sourceFile: "src/metrics/retrospective.ts",
    sourceSymbol: "improvementLeadTime",
    testFile: "tests/metrics/retrospective.test.ts",
  },
]);
