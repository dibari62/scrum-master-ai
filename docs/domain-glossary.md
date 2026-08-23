# Glossario di dominio

Vocabolario condiviso del progetto. **Usa esattamente questi termini** nel codice, negli
schemi, nelle API e nella documentazione. I sinonimi generano divergenza fra agenti che
lavorano in parallelo ed è uno dei modi più rapidi per rendere incoerente un codebase.

## Regola di denominazione

- Identificatori di codice in **inglese** (`WorkItem`, `sprintId`, `cycleTime`).
- Documentazione e interfaccia in **italiano**.
- Questa tabella lega i due mondi: la colonna *Codice* è vincolante.

---

## 1. Entità della piattaforma

| Codice | Italiano | Definizione | Da non confondere con |
|---|---|---|---|
| `Organization` | Azienda | Il tenant. Chi si registra al portale. Radice di ogni dato. | `Team` |
| `User` | Utente | Persona che accede al portale (non necessariamente membro di un team) | `Person` |
| `Membership` | Appartenenza | Legame `User` ↔ `Organization` con un ruolo | |
| `Project` | Progetto | Un'iniziativa aziendale che richiede uno Scrum Master. Contenitore di sprint, work item e integrazioni. | `Product` |
| `ScrumAgent` | Scrum Master AI | L'istanza creata per un progetto: persona, skill abilitate, policy, memoria. **Non è un modello addestrato.** | agente generico del runtime |
| `Integration` | Integrazione | Collegamento configurato verso una fonte dati esterna | `Connector` |
| `Connector` | Connettore | Il **codice** che traduce una fonte esterna nel modello canonico | `Integration` (la configurazione) |

> `Integration` è il dato (quale account, quali credenziali, quale board).
> `Connector` è il software. Non usarli come sinonimi.

---

## 2. Modello canonico Scrum

Il livello che rende il prodotto indipendente dallo strumento di origine.

| Codice | Italiano | Definizione |
|---|---|---|
| `Sprint` | Sprint | Iterazione a durata fissa, con date di inizio/fine e un obiettivo |
| `SprintGoal` | Obiettivo di sprint | Lo scopo unico dello sprint. Testo, non lista di task. |
| `WorkItem` | Elemento di lavoro | **Termine unico** per story, bug, task, epic. Il tipo è il campo `kind`. |
| `WorkItemKind` | Tipo | `story` \| `bug` \| `task` \| `epic` \| `spike` |
| `WorkItemState` | Stato | Stato canonico: `todo` \| `in_progress` \| `in_review` \| `blocked` \| `done` \| `cancelled` |
| `countsTowardWip` | Stati in carico | `in_progress`, `in_review`. Quanto la squadra ha preso e non ancora chiuso. Alimenta il WIP. |
| `isValueAdding` | Stati di lavorazione | `in_progress`. Quando qualcuno ci sta davvero lavorando. Alimenta l'efficienza di flusso. |
| `StateTransition` | Transizione | Passaggio di un work item da uno stato a un altro, con timestamp. **È la materia prima di quasi tutte le metriche.** |
| `Estimate` | Stima | Valore + unità (`points` \| `hours`). Mai assumere gli story point. |
| `Board` | Board | Rappresentazione a colonne del flusso di lavoro |
| `BoardColumn` | Colonna | Colonna della board, mappata su uno `WorkItemState` canonico |
| `Backlog` | Backlog | Insieme ordinato di work item non ancora in uno sprint |
| `SprintBacklog` | Backlog di sprint | Work item selezionati per lo sprint + piano per raggiungere l'obiettivo |
| `Impediment` | Impedimento | Ostacolo che rallenta o blocca il team. Ha apertura, eventuale chiusura, e un impatto. |
| `Person` | Persona | Membro del team come appare nelle fonti dati. **Pseudonimizzabile.** |
| `Comment` | Commento | Testo associato a un work item |
| `Message` | Messaggio | Testo proveniente da uno strumento di comunicazione |
| `Meeting` | Riunione | Evento con eventuale trascrizione |
| `Decision` | Decisione | Scelta registrata, con contesto e data. Alimenta il Q&A. |
| `PullRequest` | Pull request | Proposta di modifica al codice |
| `Deployment` | Rilascio | Messa in produzione di una versione |
| `Incident` | Incidente | Malfunzionamento in produzione |

### Aggiunte proposte — in attesa di approvazione

> Introdotte insieme alle entità Scrum di T1. Restano qui finché il Product Owner
> non le approva; una volta approvate vanno assorbite nella tabella sopra.

| Codice | Italiano | Definizione | Perché serve |
|---|---|---|---|
| `SprintScopeEvent` | Variazione di perimetro | Ingresso o uscita di un `WorkItem` da uno `Sprint`, con istante e verso (`added` \| `removed`). | `scopeChange` è definita come lavoro aggiunto o rimosso **dopo** l'inizio dello sprint, e `carryOver` richiede di sapere che l'item era nello sprint precedente. Un `sprintId` sul `WorkItem` dice dove si trova **adesso** e perde entrambe le informazioni: è lo stesso motivo per cui ADR-0003 rende `StateTransition` un'entità di primo livello invece di leggere lo stato corrente. |
| `SourceSystem` | Sistema di origine | Fonte da cui un connettore traduce: `seed` \| `github` \| `jira`. | ADR-0003 impone `sourceSystem` e `sourceId` su ogni entità canonica. `seed` è membro a pieno titolo, non un espediente per i test: è ciò che permette di costruire metriche e skill prima di avere una credenziale reale. |

---

## 5.bis Questioni aperte — decide il Product Owner

> Ambiguità incontrate scrivendo il codice. `AGENTS.md` §10.1 vieta di indovinare:
> restano qui finché non vengono risolte.

### Q1 — `in_review` conta come stato attivo? — **DECISA**

> **Decisione del Product Owner, 21 agosto 2026: opzione 2.**
> `in_review` conta nel WIP ma **non** è tempo di lavorazione.
> Attuata in `src/domain/work-item.ts` (`countsTowardWip`, `isValueAdding`).

**Dove si era manifestata.** Scrivendo `flowEfficiency` in `src/metrics`.

**Il conflitto.** Il glossario definiva `wip` come «work item contemporaneamente
in stati attivi (`in_progress`, `in_review`)» e `flowEfficiency` come «tempo in
stati attivi ÷ tempo totale». Con la stessa lista per entrambe, **un collo di
bottiglia in revisione diventava invisibile**: un elemento che passa da
`in_progress` a `in_review` a `done` otteneva efficienza 1 anche dopo quattro
giorni di attesa. Sui dati sintetici l'efficienza mediana era esattamente 1
mentre l'attesa in revisione cresceva da ore a giorni.

**Perché l'opzione 2.**

*Il numero era la prova.* Nella letteratura Lean/Kanban l'efficienza di flusso
misurata sul lavoro software sta tipicamente fra il **5% e il 15%**; il 40% è
considerato eccellente. Il motivo è strutturale: la maggior parte del tempo di
un elemento è coda, non lavorazione. Un 100% non era una buona notizia sulla
squadra: era il sintomo che la definizione misurava altro. **Una metrica che non
può scendere sotto una soglia non è una misura, è una costante travestita.**

*L'obiezione non reggeva.* Il costo dichiarato dell'opzione 2 era «due
definizioni di attivo nello stesso sistema». Ma non erano due definizioni della
stessa cosa: erano **due concetti diversi chiamati con una parola sola**.

| Domanda | Cosa conta | Perché |
|---|---|---|
| **WIP** — quanto ha in carico la squadra? | `in_progress`, `in_review` | Un elemento in revisione è un impegno preso e non chiuso: occupa un posto. Misura il **carico**. |
| **Efficienza di flusso** — quanto di quel tempo è stato lavoro? | `in_progress` | Un elemento in coda di revisione non sta venendo lavorato. Misura lo **spreco**. |

Il rimedio non è scegliere fra le due liste, è smettere di chiamarle con lo
stesso nome. Da qui i due termini della sezione seguente.

**Approssimazione accettata e dichiarata.** Escludendo tutto `in_review` si
contano come spreco anche i minuti in cui il revisore sta effettivamente
leggendo. Il modello canonico non distingue «in attesa di revisione» da «in
revisione», perché quasi nessuna fonte espone la differenza. L'approssimazione
sbaglia **nella direzione giusta**: mostra un collo di bottiglia che potrebbe non
esserci, invece di nascondere uno che c'è.

**Perché non l'opzione 3 (uno stato canonico `review_wait`).** Obbligherebbe i
connettori a *dedurlo*, e la regola 4 dei connettori vieta di fingere che un dato
ci sia quando la fonte non lo espone. **Ma tornerà disponibile**: la tabella
`pull_requests` ha già `opened_at` e `first_review_at`, quindi con il connettore
GitHub l'attesa di revisione sarà un dato **osservato, non dedotto**. A quel
punto l'opzione 3 va riconsiderata.

**Conseguenza sull'interfaccia.** `flowEfficiency` dice che del tempo si è perso
ma non dove; `reviewWaitTime` dice dove. La dashboard le mostra **affiancate**:
la prima versione mostrava solo l'efficienza, ed era fuorviante.

---

### Q2 — un elemento `blocked` fa parte del carico? — aperta

**Dove si è manifestata.** Chiudendo Q1, riformulando il WIP come misura del
*carico*.

**Il conflitto.** Se il WIP misura quanto la squadra ha in carico, un elemento
bloccato **è** carico: è stato preso, non è chiuso, e qualcuno dovrà tornarci.
Oggi `blocked` è escluso, con una motivazione altrettanto sensata: contarlo
farebbe sembrare occupata una squadra ferma.

**Perché non l'ho deciso io.** La decisione su Q1 riguardava `flowEfficiency`;
estenderla al WIP sarebbe stato un cambiamento diverso, fatto passare di
contrabbando. Il comportamento attuale resta invariato finché il Product Owner
non decide.

**Nota pratica.** Nei sistemi Kanban il limite di WIP di solito **include** gli
elementi bloccati, proprio perché il senso del limite è impedire alla squadra di
prendere altro lavoro mentre ne ha di fermo.

**Stato:** in attesa di decisione. Comportamento attuale: `blocked` escluso.


### Eventi Scrum

| Codice | Italiano |
|---|---|
| `SprintPlanning` | Pianificazione dello sprint |
| `DailyScrum` | Daily Scrum (**mai** "stand-up" nel codice) |
| `SprintReview` | Revisione dello sprint |
| `SprintRetrospective` | Retrospettiva |
| `BacklogRefinement` | Affinamento del backlog |

---

## 3. Metriche

Tutte calcolate in `src/metrics` in modo deterministico. Definizioni vincolanti: se una
metrica è ambigua, l'ambiguità va risolta **qui** prima di implementarla.

| Codice | Italiano | Definizione operativa |
|---|---|---|
| `velocity` | Velocity | Somma delle stime dei work item arrivati a `done` **entro** la fine dello sprint. Esclude quelli riaperti dopo. |
| `burndown` | Burndown | Serie temporale del lavoro residuo per giorno dello sprint |
| `cycleTime` | Cycle time | Tempo dal primo ingresso in `in_progress` al primo ingresso in `done` |
| `leadTime` | Lead time | Tempo dalla creazione del work item al primo ingresso in `done` |
| `throughput` | Throughput | Numero di work item completati per unità di tempo |
| `wip` | WIP | Work item contemporaneamente in **stati in carico** (`in_progress`, `in_review`). Misura il carico, non il lavoro. |
| `flowEfficiency` | Efficienza di flusso | Tempo in **stati di lavorazione** ÷ tempo totale di attraversamento, dal primo `in_progress`. Nel software è normale che stia fra 5% e 15% (Q1). |
| `agingWorkItem` | Invecchiamento | Tempo trascorso nello stato attuale da un item non ancora concluso |
| `scopeChange` | Variazione di perimetro | Lavoro aggiunto o rimosso dallo sprint **dopo** l'inizio |
| `carryOver` | Lavoro trascinato | Work item non completati che passano allo sprint successivo |
| `reopenRate` | Tasso di riapertura | Quota di item che tornano da `done` a uno stato non terminale |
| `blockedTime` | Tempo bloccato | Tempo cumulato in stato `blocked` |
| `reviewWaitTime` | Attesa in revisione | Durata dell'**ultima** permanenza in `in_review`. Vedi la nota qui sotto. |

> **Nota su `reviewWaitTime`.** Questa voce definiva l'attesa come «tempo fra
> apertura della PR e primo commento di revisione», mentre il codice misura la
> permanenza nello stato `in_review`. Sono due cose diverse, e la divergenza è
> stata scoperta chiudendo Q1. Vince la definizione basata sullo stato, perché è
> l'unica calcolabile oggi: il connettore seed non produce pull request
> collegate a una revisione reale.
>
> La versione basata sulla PR è **migliore** — misura l'attesa osservata invece
> di dedurla dal movimento su una board — e le colonne `opened_at` e
> `first_review_at` esistono già in `pull_requests`. Diventerà calcolabile con il
> connettore GitHub, e a quel punto le due letture andranno confrontate prima di
> sostituire l'una con l'altra.

### Metriche DORA

| Codice | Italiano |
|---|---|
| `deploymentFrequency` | Frequenza di rilascio |
| `leadTimeForChanges` | Lead time per le modifiche |
| `changeFailureRate` | Tasso di fallimento delle modifiche |
| `timeToRestore` | Tempo di ripristino |

### ⚠️ Metriche vietate

Non implementare, nemmeno se richieste: velocity individuale, conteggio commit o righe
per persona, classifiche fra membri, punteggi di "produttività" individuale, punteggi di
umore o emozione riferibili a una persona. Si misura il **processo**, non le persone
(vedi `AGENTS.md` §8.2).

---

## 4. Concetti dello Scrum Master AI

| Codice | Italiano | Definizione |
|---|---|---|
| `Skill` | Skill | Una capacità attivabile dello `ScrumAgent` (es. report di sprint, digest giornaliero) |
| `SkillRun` | Esecuzione | Una singola esecuzione di una skill, con input, output, costo, esito |
| `Trigger` | Trigger | Cosa avvia una skill: `scheduled` \| `event` \| `on_demand` |
| `AutonomyLevel` | Livello di autonomia | `observe` \| `report` \| `advise` \| `act_with_approval` \| `autonomous` |
| `ProjectMemory` | Memoria di progetto | Fatti durevoli: decisioni, impedimenti ricorrenti, correzioni dell'umano |
| `KnowledgeItem` | Elemento di conoscenza | Documento indicizzato per il Q&A (DoD, working agreement, ADR) |
| `Insight` | Insight | Osservazione generata: ha evidenza, confidenza e, se possibile, azione suggerita |
| `Alert` | Segnalazione | Insight che richiede attenzione tempestiva |
| `ImprovementBacklog` | Backlog di miglioramento | Azioni di miglioramento emerse dalle retrospettive, con verifica dell'effetto |
| `Digest` | Digest | Sintesi periodica di cosa è cambiato |
| `SprintReport` | Report di sprint | Documento di fine sprint, declinato per pubblico |
| `Audience` | Pubblico | `team` \| `manager` \| `stakeholder` — cambia registro e livello di dettaglio |

### Livelli di autonomia

| Livello | Comportamento |
|---|---|
| `observe` | Ingerisce dati, non produce nulla verso l'esterno. Solo dashboard. |
| `report` | Pubblica report e digest su canali dedicati |
| `advise` | Propone azioni in privato allo Scrum Master umano |
| `act_with_approval` | Prepara l'azione, ma serve conferma esplicita |
| `autonomous` | Agisce su azioni whitelistate a basso rischio. Mai il default. |

### Aggiunte proposte — T3, in attesa di approvazione

> Introdotte scrivendo la specifica di T3 ([`specs/scrum-agent/spec.md`](../specs/scrum-agent/spec.md)).
> Restano qui finché il Product Owner non le approva; una
> volta approvate vanno assorbite nella tabella sopra.

| Codice | Italiano | Definizione | Perché serve |
|---|---|---|---|
| `ProjectContext` | Contesto di progetto | Come lavora questo team: durata dello sprint, calendario delle cerimonie, Definition of Done, working agreement, stakeholder. **Dichiarato dall'umano, non dedotto dai dati.** | La roadmap lo richiede in T3 e nessun termine esistente lo copre. Va distinto dal modello canonico: il canonico dice cosa è *successo*, il contesto dice come il team ha *deciso* di lavorare. |
| `CeremonySchedule` | Calendario delle cerimonie | Per ciascun evento Scrum, giorno della settimana e ora, oppure «non pianificata». | Gli eventi Scrum esistono già nel glossario come nomi; mancava il modo di dire *quando* si tengono in un progetto concreto. |
| `DefinitionOfDone` | Definizione di Fatto | Elenco di condizioni che un `WorkItem` deve soddisfare perché questo team lo consideri `done`. | Termine standard di Scrum, usato dalla roadmap. Non va confuso con lo stato canonico `done`, che dice solo dove si trova l'elemento. |
| `WorkingAgreement` | Patto di squadra | Regole di collaborazione che la squadra si è data. Testo libero, trattato come **dato non fidato** (§8.1). | Richiesto dalla roadmap. La qualifica «non fidato» è parte della definizione, non una nota a margine: è testo che finirà accanto a un prompt. |
| `Stakeholder` | Portatore di interesse | Destinatario delle comunicazioni dell'agente, qualificato da un ruolo e da un `Audience`. **Non** è una `Person` del modello canonico. | Senza la distinzione, «stakeholder» finirebbe confuso con i membri del team presenti nelle fonti dati, con conseguenze diverse sulla privacy. |
| `AgentPersona` | Persona | Il ruolo che lo `ScrumAgent` assume nel comunicare (es. facilitatore, analista di flusso). Influenza il registro, **mai i fatti**. | «Persona» da solo collide con `Person`: il codice usa `AgentPersona` per non lasciare ambiguità. |
| `AgentTone` | Tono | Registro comunicativo: `neutral` \| `concise` \| `supportive` \| `formal`. | Insieme chiuso: un tono libero è un canale di iniezione nel prompt. |
| `AgentLanguage` | Lingua | Lingua in cui lo `ScrumAgent` produce i propri output: `it` \| `en`. Non è la lingua dell'interfaccia, né riscrive i dati di origine. | Lacuna trovata scrivendo i contratti Zod: la specifica la richiede in tre criteri, ma le aggiunte T3 non la nominavano. Chiusa e non testo libero perché il valore finisce in una richiesta al modello. |
| `AgentStatus` | Stato dell'agente | `active` \| `suspended`. | Serve poter fermare un agente senza cancellarne configurazione e storia. |
| `AgentPolicy` | Policy | Vincoli operativi applicati **dal codice**: budget di token per esecuzione, tetto giornaliero di esecuzioni, divieti non disattivabili. | Distingue ciò che è configurabile da ciò che è imposto: i divieti di §8.2 sono policy che l'utente vede ma non può togliere. |
| `SkillCatalog` | Catalogo delle skill | Dichiarazione, nel codice, delle skill esistenti: chiave, trigger ammessi, autonomia minima, budget. Non modificabile dall'utente. | Una skill è una funzione tipizzata (ADR-0004): l'elenco è codice, non dato dell'utente. |
| `SkillKey` | Chiave di skill | Identificatore stabile di una skill (`configuration-check`, `sprint-report`, …). | Le abilitazioni persistite devono riferire una chiave stabile, non un nome visualizzato. |
| `SkillRunStatus` | Esito | `succeeded` \| `failed`. | `SkillRun` esiste già in glossario con «esito», ma senza valori: due agenti in parallelo ne inventerebbero due insiemi diversi. |
| `SkillRunFailureCause` | Causa di fallimento | `budget_exceeded` \| `quota_exceeded` \| `provider_not_configured` \| `provider_unavailable` \| `rate_limited` \| `timeout` \| `invalid_output` \| `agent_suspended`. | «Fallito» senza causa non è diagnosticabile, e l'interfaccia deve dire cosa fare. |
| `LlmProvider` | Fornitore di modello | `gemini` \| `groq` \| `fake` (ADR-0005). Registrato su ogni `SkillRun`. | Con un fallback fra due fornitori, sapere chi ha servito una richiesta è parte del registro. |
| `TokenBudget` | Budget di token | Tetto massimo di token per una singola esecuzione, dichiarato dalla skill e riducibile dalla policy. | ADR-0004 impone che ogni skill dichiari un budget; serve il nome del concetto. |

### Aggiunte proposte — T4, in attesa di approvazione

> Introdotte scrivendo la specifica della prima skill che narra numeri
> ([`specs/sprint-report/spec.md`](../specs/sprint-report/spec.md)). Restano qui finché il
> Product Owner non le approva; una volta approvate vanno assorbite nella tabella sopra.

| Codice | Italiano | Definizione | Perché serve |
|---|---|---|---|
| `MetricSnapshot` | Istantanea delle metriche | L'oggetto strutturato con tutti i valori prodotti da `src/metrics` per un `SprintReport`, congelato al momento della generazione e conservato insieme al report. | Un report va riletto fra tre mesi e deve continuare a dire gli stessi numeri. Ricalcolarli alla rilettura li farebbe cambiare sotto gli occhi del lettore; senza un nome, ogni agente chiamerebbe questa cosa in modo diverso. |
| `CitableValue` | Valore citabile | Una stringa **già formattata dal codice** (numero, unità, data) che il modello è autorizzato a riportare nel testo, con il `metricId` da cui proviene. L'insieme dei valori citabili è chiuso. | È il meccanismo con cui R1 diventa verificabile invece che raccomandata: se ogni numero del testo deve appartenere a questo insieme, un numero inventato o calcolato dal modello è rilevabile da una macchina. |
| `ReportEvidence` | Evidenza del report | L'insieme di `WorkItem` selezionati dal codice con regole deterministiche e passati al modello come **contenuto non fidato**, ciascuno con il motivo della selezione. | §9 impone il pre-filtro deterministico. «Gli elementi rilevanti» va nominato, altrimenti diventa «il contesto», che è tutto e niente. |
| `EvidenceReason` | Motivo di selezione | Perché un `WorkItem` è finito nell'evidenza: `carry-over` \| `mid-sprint-addition` \| `long-review-wait` \| `reopened` \| `long-cycle-time`. Insieme chiuso, scritto dal codice. | Il motivo è un fatto calcolato, non un'interpretazione del modello. Averlo esplicito permette di verificare la selezione senza rileggere il prompt. |
| `DataGap` | Lacuna di dato | La dichiarazione che una metrica **non è disponibile** per questo sprint, con il motivo. Scritta dal codice, mai dedotta dal modello. | «Sprint vuoto» e «sprint disastroso» devono essere distinguibili nel testo come lo sono già in `MetricResult`. Senza questo termine la traduzione fra i due livelli si perde. |
| `AttentionPoint` | Punto di attenzione | Osservazione **di processo** contenuta in un report, obbligatoriamente ancorata a un `metricId` disponibile nell'istantanea. Non ha confidenza e non propone azioni. | Va distinto da `Insight`, che è un'entità persistita di T5 con evidenza, confidenza ed eventuale azione suggerita. Confonderli farebbe scivolare il livello di autonomia da `report` ad `advise` senza che nessuno lo decida. |
| `ReportOrigin` | Origine del report | Chi ha prodotto il testo: `model` (narrato da un modello) \| `code` (composto dal codice, quando non c'è nulla da narrare). | Un report su uno sprint vuoto è legittimo ma non è stato scritto da un modello. Dichiararlo evita che una dimostrazione sembri usare l'IA dove non la usa. |
| `GoldenDataset` | Dataset dorato | Insieme fisso di casi di ingresso, con le proprietà attese del risultato, su cui si valutano gli output di un modello. Vive in `evals/`. | `AGENTS.md` §6 lo usa già come espressione corrente ma non lo definisce; è l'unità di misura di ogni modifica a un prompt. |
| `NumericFidelity` | Fedeltà numerica | Proprietà verificata su un output: ogni numero citato nel testo appartiene ai `CitableValue` dell'istantanea. | È il nome della verifica che la roadmap chiede in T4. Nominata, può essere una eval; non nominata, resta un'intenzione. |

---

## 5. Termini da non usare

| ❌ Evita | ✅ Usa |
|---|---|
| ticket, issue, story, task (come tipo generico) | `WorkItem` |
| stand-up | `DailyScrum` |
| azienda / cliente / tenant (nel codice) | `Organization` |
| status / stato del ticket | `WorkItemState` |
| «stato attivo» | **da non usare**: dire `countsTowardWip` (carico) oppure `isValueAdding` (lavorazione). Una parola per due concetti è ciò che ha prodotto Q1. |
| agente (per lo Scrum Master del progetto) | `ScrumAgent` |
| sentiment | indicatore di processo aggregato |
| performance del team (come giudizio) | metrica di flusso |
| «persona» (per il carattere dello Scrum Master AI) | `AgentPersona` — `Person` è il membro del team nelle fonti dati |
| «stakeholder» come sinonimo di membro del team | `Stakeholder` è un destinatario di comunicazioni, `Person` è chi lavora nel progetto |
| «contesto» (per gli elementi passati al modello) | `ReportEvidence` — «contesto» significa già `ProjectContext` |
| «insight» (per un'osservazione dentro un report) | `AttentionPoint` — `Insight` è l'entità persistita di T5, con confidenza e azione |
| «dato mancante» come sinonimo di zero | `DataGap` — l'assenza di una metrica è un fatto da dichiarare, non un valore |
