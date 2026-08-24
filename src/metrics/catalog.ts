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
      "Somma delle stime degli elementi che risultavano «conclusi» nell'istante di chiusura dello sprint, calcolata separatamente per ogni unità di stima.",
    unit: "points",
    excludes: [
      "Gli elementi conclusi e poi riaperti prima della fine: alla chiusura non erano conclusi.",
      "Gli elementi entrati e poi usciti dallo sprint.",
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
        reads: "gli ingressi e le uscite, per ricostruire cosa c'era dentro alla chiusura",
      },
      {
        entity: "StateTransition",
        reads: "la storia di ogni elemento, per sapere chi risultava concluso a quell'istante",
      },
      {
        entity: "WorkItem",
        reads: "la stima e la sua unità di misura",
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
      "Un campione al giorno, preso all'ora di inizio dello sprint, di quanto lavoro risultava ancora aperto in quell'istante.",
    unit: "points",
    excludes: [
      "Gli elementi conclusi e quelli annullati, che è esattamente ciò che fa scendere la linea.",
      "Nessun elemento entrato a metà sprint viene ignorato: la composizione è ricalcolata a ogni campione, ed è per questo che la linea può salire.",
    ],
    unavailableWhen: "Lo sprint non ha una durata valida.",
    inputs: [
      {
        entity: "Sprint",
        reads: "l'istante di inizio e la data di fine, che delimitano l'arco campionato",
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
        entity: "WorkItem",
        reads: "la stima degli elementi ancora aperti, tenuta separata per unità",
      },
    ],
    observation: {
      kind: "history",
      over:
        "dall'inizio dello sprint fino alla sua fine pianificata o all'istante di riferimento, quello che viene prima, un campione ogni ventiquattro ore a partire dall'ora di inizio",
    },
    operation: "series",
    summarisedBy: [],
    sampleSizeMeaning: "quanti campioni compongono la linea, cioè quanti giorni copre",
    referenceInstant: "parametro asOf",
    edgeCases: [
      {
        situation: "Del lavoro entra nello sprint dopo l'inizio.",
        outcome: "La linea sale: la composizione è ricalcolata a ogni campione.",
        verifiedBy: "la linea sale quando arriva lavoro a metà sprint",
      },
      {
        situation: "Lo sprint dura un solo giorno.",
        outcome: "Un punto, non zero punti: l'estremo iniziale è sempre campionato.",
        verifiedBy: "gestisce uno sprint di un solo giorno",
      },
      {
        situation: "Lo sprint è ancora in corso.",
        outcome:
          "La linea si ferma a oggi invece di proseguire piatta fino alla data di fine, che sembrerebbe lavoro fermo.",
        verifiedBy: "si ferma a oggi invece di disegnare i giorni non ancora avvenuti",
      },
    ],
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
]);
