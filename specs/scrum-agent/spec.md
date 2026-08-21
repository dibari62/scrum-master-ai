# Spec — Creazione dello Scrum Master AI (`ScrumAgent`)

- **Stato:** bozza
- **Autore:** Product Analyst (agente), rivista dall'agente incaricato dello sviluppo
- **Data:** 2026-08-21
- **Traguardo di roadmap:** T3 — Creazione dello Scrum Master AI

---

## 1. Problema

Oggi un progetto ha dati canonici e una dashboard di metriche corretta (T1, T2), ma **non
esiste l'oggetto attorno a cui ruota l'intero prodotto**: lo `ScrumAgent`. Non c'è un posto
dove sia scritto in che lingua e con che tono l'assistente parla, quali capacità gli sono
concesse, fin dove può spingersi, né qual è il contesto operativo del progetto (durata
degli sprint, cerimonie, Definition of Done, working agreement, stakeholder).

In sua assenza ogni skill di T4 dovrebbe reinventarsi la propria configurazione, ogni
chiamata a un modello sarebbe fatta al volo da un punto qualsiasi del codice, e non
esisterebbe alcuna traccia di **cosa è stato eseguito, con che esito e a che costo**. È
esattamente il debito che ADR-0004 e ADR-0005 esistono per evitare.

T3 costruisce quindi **l'oggetto e l'infrastruttura**, non le capacità: al termine il
sistema sa *chi* è lo Scrum Master AI di un progetto e sa *eseguire e registrare* qualcosa,
ma non produce ancora né report né digest.

## 2. Risultato atteso

Un utente che ha già un progetto popolato apre la pagina del progetto, vede che non ha
ancora uno Scrum Master AI, avvia il wizard, e in **quattro passi con valori predefiniti
sensati** arriva a una scheda che descrive il suo Scrum Master AI: nome, persona, tono,
lingua, livello di autonomia, skill abilitate, policy e contesto di progetto.

Dalla scheda può premere **"Verifica configurazione"**: parte un'esecuzione reale
attraverso il gateway LLM (in sviluppo e in test con provider fittizio, senza rete) e nel
**registro delle esecuzioni** compare una riga con esito, provider, modello, token e costo
stimato.

La dimostrazione è: *dalla dashboard di progetto alla scheda dell'agente attivo, con una
esecuzione registrata, in meno di due minuti e senza dover compilare nulla oltre a
confermare i valori proposti.*

## 3. Perimetro

**Incluso**

- Entità `ScrumAgent`, una per `Project`, con: nome, persona, tono, lingua, livello di
  autonomia, insieme di skill abilitate, policy operative, stato (`active` | `suspended`).
- **Contesto di progetto** (`ProjectContext`): durata dello sprint, calendario delle
  cerimonie, Definition of Done, working agreement, elenco degli stakeholder.
- **Wizard di creazione** in quattro passi, con valori predefiniti precompilati e creazione
  atomica alla conferma finale.
- **Scheda dell'agente** in sola lettura più modifica della configurazione dopo la
  creazione (identità, contesto, capacità, policy).
- **Catalogo delle skill** dichiarativo: ogni voce dichiara chiave, nome, descrizione,
  trigger ammessi, livello di autonomia minimo, budget di token. Le voci di T4/T5/T6
  compaiono nel catalogo come **dichiarazioni non ancora disponibili**.
- **Gateway LLM** (`src/lib/llm`): unico punto di accesso ai fornitori, selezione da
  variabile d'ambiente, provider fittizio deterministico, fallback al fornitore di riserva,
  applicazione del budget di token, misurazione di token, durata e costo, normalizzazione
  degli errori.
- **Registro delle esecuzioni** (`SkillRun`): una riga per esecuzione, con esito, causa di
  fallimento, provider e modello usati, token in ingresso e in uscita, costo stimato,
  durata; pagina di consultazione filtrata per progetto.
- Una sola esecuzione realmente eseguibile in T3: **`configuration-check`** ("verifica
  configurazione"), che serve a dimostrare gateway e registro. Non è una skill Scrum: non
  legge work item, non legge metriche, non riceve testo ingerito.

**Escluso** *(sezione obbligatoria: impedisce agli agenti di espandere il lavoro)*

- **Le skill vere e proprie.** `sprint-report` e `daily-digest` sono **T4**;
  `sprint-health` e `bottleneck-detection` sono **T5**; `project-qa` è **T6**. T3 non
  produce un solo report, digest, semaforo o risposta. Se al termine di T3 esiste un
  output narrativo su dati di progetto, il perimetro è stato violato.
- **Prompt di narrazione, dataset dorati ed eval di fedeltà numerica**: nascono con la
  prima skill che narra numeri (T4). In T3 non c'è nulla da valutare.
- **`ProjectMemory`, `KnowledgeItem`, indicizzazione pgvector, embedding**: T6.
- **`Insight`, `Alert`, backlog di miglioramento**: T5.
- **Schedulazione**: nessun cron, nessun QStash, nessuna route invocata dall'esterno. In T3
  l'unico trigger ammesso è `on_demand`; `scheduled` ed `event` esistono nel catalogo come
  dichiarazioni, non come meccanismi funzionanti (T5).
- **Livelli di autonomia `act_with_approval` e `autonomous`**: fuori perimetro per l'intero
  PoC (roadmap, "Fuori perimetro per ora"). Non selezionabili e rifiutati in validazione.
- **Canali in uscita** (Slack, Teams, e-mail, webhook): il livello `report` in T3 significa
  soltanto "abilitato a produrre output dentro l'applicazione". Nessuna pubblicazione
  esterna, nessuna azione scrivente verso sistemi terzi.
- **Integrazioni e connettori reali**: T7. Il progetto continua a essere alimentato dal
  connettore `seed`.
- **Riscontro dell'utente sugli output** (utile / non utile / correggi): T4.
- **Modifica dei prompt di sistema da parte dell'utente**: i prompt sono file versionati nel
  repository (`.github/instructions/agents-runtime.instructions.md`). Nessun campo
  dell'interfaccia inietta testo dell'utente nel prompt di sistema.
- **Più agenti per progetto, agenti condivisi fra progetti, modelli di agente riusabili a
  livello di organizzazione**: un progetto, uno Scrum Master AI.
- **Chat interattiva, streaming, cronologia conversazionale, avatar o voce**: nessuna
  interazione libera in T3.
- **Scelta del modello da parte dell'utente**: il fornitore e il modello sono decisi dal
  gateway (ADR-0005), non dalla configurazione dell'agente. Una skill non sa chi l'ha
  servita.
- **Fatturazione, quote a pagamento, piani commerciali, onboarding**: fuori perimetro di
  roadmap. Il tetto di esecuzioni di T3 è una protezione tecnica, non un piano tariffario.
- **Qualunque campo che descriva, valuti o classifichi una singola persona** (competenza,
  affidabilità, umore, carico individuale): vietato da `AGENTS.md` §8.2 e non ammesso nel
  modello dati nemmeno come campo libero etichettato.
- **Traduzione automatica dei contenuti ingeriti**: la lingua configurata determina la
  lingua dell'output dell'agente, non riscrive i dati di origine.

## 4. Comportamento

### Percorso principale

1. **Punto di partenza.** Nella pagina del progetto, se il progetto non ha uno
   `ScrumAgent`, compare un riquadro "Questo progetto non ha ancora uno Scrum Master AI"
   con l'azione **"Crea lo Scrum Master AI"**. Se ce l'ha, il riquadro è sostituito da un
   collegamento alla scheda dell'agente.

2. **Passo 1 — Identità.** Campi: nome (precompilato con «Scrum Master di <nome del
   progetto>»), persona, tono, lingua.
   - Il tono è una scelta fra valori predefiniti; il predefinito è `neutral`.
   - La lingua predefinita è `it` (vedi questione aperta Q2).
   - Solo il nome è obbligatorio, ed è già compilato: si può proseguire senza digitare.

3. **Passo 2 — Contesto di progetto.** Campi: durata dello sprint in giorni, calendario
   delle cerimonie (`SprintPlanning`, `DailyScrum`, `SprintReview`, `SprintRetrospective`,
   `BacklogRefinement`, ciascuna con giorno della settimana e ora, oppure "non
   pianificata"), Definition of Done come elenco di voci, working agreement come testo,
   stakeholder come elenco di ruolo + pubblico (`Audience`).
   - La durata dello sprint è **proposta dal codice**: se il progetto ha almeno due sprint
     con date di inizio e fine valide, la proposta è la mediana arrotondata delle durate
     osservate; altrimenti è 14. La proposta è modificabile e non è mai un calcolo
     dell'LLM (R1).
   - Tutti gli altri campi sono facoltativi: ciò che non viene compilato risulta «non
     impostato» sulla scheda, e non blocca la creazione.

4. **Passo 3 — Capacità e autonomia.** L'utente sceglie il livello di autonomia (predefinito
   `observe`) e attiva le skill dal catalogo.
   - Le skill con autonomia minima superiore a quella scelta sono mostrate disattivate, con
     il motivo esplicito («richiede almeno il livello *report*»).
   - Le skill non ancora disponibili (T4–T6) sono mostrate con l'etichetta «disponibile dal
     traguardo T4» e possono essere abilitate come dichiarazione d'intento, ma non
     eseguite.
   - Le policy modificabili sono due: budget massimo di token per esecuzione (proposto dal
     catalogo della skill) e tetto di esecuzioni giornaliere.
   - Le policy **non disattivabili** sono mostrate in sola lettura: nessuna valutazione di
     singole persone, nessuna inferenza su stati d'animo, il testo ingerito è dato e non
     istruzione, nessuna azione scrivente verso sistemi esterni (`AGENTS.md` §8.1 e §8.2).

5. **Passo 4 — Riepilogo e conferma.** L'utente vede tutto ciò che sta per creare e
   conferma. La creazione è **atomica**: o nascono insieme `ScrumAgent`, `ProjectContext` e
   le abilitazioni delle skill, o non nasce nulla. Al termine si atterra sulla scheda
   dell'agente.

6. **Scheda dell'agente.** Mostra identità, contesto, capacità, policy, stato e il registro
   delle ultime esecuzioni. Ogni sezione è modificabile. L'azione **"Verifica
   configurazione"** esegue `configuration-check` attraverso il gateway e aggiunge una riga
   al registro.

7. **Registro delle esecuzioni.** Elenco delle esecuzioni del progetto, dalla più recente,
   con: istante, skill, trigger, esito, causa in caso di fallimento, provider, modello,
   token in ingresso e in uscita, costo stimato, durata.

### Percorsi alternativi

- **Il progetto ha già uno `ScrumAgent`.** Il wizard non è raggiungibile: l'accesso
  all'indirizzo di creazione reindirizza alla scheda esistente. Un secondo tentativo di
  creazione via API è rifiutato come conflitto.
- **Wizard abbandonato.** Chiudere il browser, tornare indietro o cambiare pagina prima
  della conferma finale non scrive nulla. Non esistono agenti in stato «bozza».
- **Conferma inviata due volte** (doppio clic, ritentativo di rete). Nasce un solo
  `ScrumAgent`; la seconda richiesta riceve la stessa risposta di successo, non un secondo
  oggetto.
- **Progetto archiviato.** Il wizard non è disponibile; un agente già esistente è
  consultabile ma non modificabile e non eseguibile.
- **Abbassamento del livello di autonomia** sotto il minimo richiesto da una skill già
  abilitata: la skill viene **disabilitata automaticamente**, e la conferma di salvataggio
  dichiara esplicitamente quali skill sono state disattivate e perché.
- **Sospensione.** L'agente può essere messo in stato `suspended`: la configurazione resta,
  ogni tentativo di esecuzione è rifiutato con causa `agent_suspended`.
- **Modifica concorrente.** Due utenti che salvano la stessa sezione: il secondo salvataggio
  viene rifiutato con un messaggio di conflitto e l'invito a ricaricare. Non si sovrascrive
  in silenzio.
- **Esecuzione fallita.** Un fallimento del provider non è un errore dell'applicazione:
  produce comunque una riga nel registro con la causa, e un messaggio comprensibile
  nell'interfaccia. Nessuna eccezione non gestita, nessun `catch` silenzioso.

## 5. Dati coinvolti

| Entità | Lettura | Scrittura | Note |
|---|---|---|---|
| `Organization` | ✅ | — | Tenant di ogni lettura e scrittura (§8.4) |
| `Project` | ✅ | — | Contenitore dell'agente; deve essere `active` per creare |
| `Membership` | ✅ | — | Determina chi può creare e modificare (vedi Q4) |
| `Sprint` | ✅ | — | Solo per proporre la durata dello sprint al passo 2 |
| `ScrumAgent` | ✅ | ✅ | Entità centrale del traguardo |
| `Skill` | ✅ | — | Catalogo dichiarativo, definito nel codice, non dall'utente |
| `SkillRun` | ✅ | ✅ | Una riga per esecuzione, anche fallita |
| `AutonomyLevel` | ✅ | ✅ | In T3 sono ammessi solo `observe` e `report` (vedi Q1) |
| `Trigger` | ✅ | ✅ | In T3 solo `on_demand` |
| `Audience` | ✅ | ✅ | Usato per qualificare gli stakeholder |
| `WorkItem`, `StateTransition`, `Person`, `Comment` | — | — | **Non letti in T3**: nessuna skill Scrum è eseguibile |

### Concetti da aggiungere al glossario

Non esistono oggi in `docs/domain-glossary.md` e servono per parlare di T3 senza inventare
sinonimi. Sono stati inseriti nel glossario, §4, sotto «Aggiunte proposte — T3», in attesa
di approvazione del Product Owner.

| Codice | Italiano | Definizione proposta |
|---|---|---|
| `ProjectContext` | Contesto di progetto | Come lavora questo team: durata dello sprint, calendario delle cerimonie, Definition of Done, working agreement, stakeholder. Configurazione dichiarata dall'umano, non dedotta dai dati. |
| `CeremonySchedule` | Calendario delle cerimonie | Per ciascun evento Scrum, giorno della settimana e ora, oppure «non pianificata». |
| `DefinitionOfDone` | Definizione di Fatto | Elenco di condizioni che un `WorkItem` deve soddisfare perché questo team lo consideri `done`. |
| `WorkingAgreement` | Patto di squadra | Regole di collaborazione che la squadra si è data. Testo libero, trattato come dato non fidato. |
| `Stakeholder` | Portatore di interesse | Destinatario delle comunicazioni dell'agente, qualificato da un ruolo e da un `Audience`. Non è una `Person` del modello canonico. |
| `AgentPersona` | Persona | Il ruolo che lo `ScrumAgent` assume nel comunicare (es. facilitatore, analista di flusso). Influenza il registro, mai i fatti. |
| `AgentTone` | Tono | Registro comunicativo: `neutral` \| `concise` \| `supportive` \| `formal`. |
| `AgentStatus` | Stato dell'agente | `active` \| `suspended`. |
| `AgentPolicy` | Policy | Vincoli operativi applicati dal codice: budget di token per esecuzione, tetto giornaliero di esecuzioni, divieti non disattivabili. |
| `SkillCatalog` | Catalogo delle skill | Dichiarazione, nel codice, delle skill esistenti: chiave, trigger ammessi, autonomia minima, budget. Non modificabile dall'utente. |
| `SkillKey` | Chiave di skill | Identificatore stabile di una skill (`configuration-check`, `sprint-report`, …). |
| `SkillRunStatus` | Esito | `succeeded` \| `failed`. |
| `SkillRunFailureCause` | Causa di fallimento | `budget_exceeded` \| `quota_exceeded` \| `provider_not_configured` \| `provider_unavailable` \| `rate_limited` \| `timeout` \| `invalid_output` \| `agent_suspended`. |
| `LlmProvider` | Fornitore di modello | `gemini` \| `groq` \| `fake` (ADR-0005). Registrato su ogni `SkillRun`. |
| `TokenBudget` | Budget di token | Tetto massimo di token per una singola esecuzione, dichiarato dalla skill e riducibile dalla policy. |

## 6. Criteri di accettazione

**Creazione e unicità**

1. Su un progetto senza `ScrumAgent`, completato il wizard con i soli valori predefiniti, la
   lettura dell'agente del progetto restituisce un oggetto con `status = "active"`; prima
   della conferma la stessa lettura restituisce «nessun agente».
2. Un secondo tentativo di creazione per lo stesso `Project` è rifiutato con errore di
   conflitto e il numero di `ScrumAgent` del progetto resta 1.
3. Se la scrittura finale fallisce a metà, il conteggio di `ScrumAgent`, `ProjectContext` e
   abilitazioni di skill del progetto resta invariato (creazione atomica).
4. Due invii identici della conferma finale producono un solo `ScrumAgent` (idempotenza
   sulla coppia organizzazione + progetto).
5. Un utente dell'organizzazione B che richiede l'agente di un progetto dell'organizzazione
   A riceve «non trovato», sia in lettura sia in modifica: l'esistenza dell'oggetto non è
   rivelabile da fuori tenant.
6. La creazione su un `Project` con `status = "archived"` è rifiutata con errore di
   validazione.

**Valori predefiniti e validazione**

7. Creando con il solo nome, i valori risultanti sono esattamente: tono `neutral`, lingua
   `it`, autonomia `observe`, nessuna skill abilitata, durata dello sprint 14 giorni,
   cerimonie tutte «non pianificata», Definition of Done vuota, working agreement nullo,
   nessuno stakeholder.
8. Il nome è precompilato con «Scrum Master di <nome del progetto>»; un nome vuoto o composto
   di soli spazi è rifiutato e non produce alcuna scrittura.
9. Se il progetto ha almeno due sprint con date di inizio e fine valide, il valore proposto
   per la durata dello sprint è la mediana arrotondata delle durate osservate in giorni; con
   meno di due sprint è 14. Il valore è calcolato dal codice: durante il wizard non avviene
   alcuna chiamata a un modello.
10. Una durata di sprint fuori dall'intervallo 1–60 giorni è rifiutata; la Definition of Done
    accetta da 0 a 20 voci di 1–200 caratteri; il working agreement accetta al massimo 4000
    caratteri; gli stakeholder sono da 0 a 20 voci con `Audience` fra `team`, `manager`,
    `stakeholder`. Ogni violazione è un errore di validazione, non un troncamento silenzioso.

**Autonomia, policy e vincoli di dominio**

11. Impostare il livello di autonomia a `advise`, `act_with_approval` o `autonomous` è
    rifiutato con errore di validazione; gli unici valori accettati in T3 sono `observe` e
    `report` (vedi Q1).
12. L'insieme dei valori ammessi per autonomia, tono, trigger, `Audience` e cause di
    fallimento è chiuso: un test enumera i valori attesi e fallisce se l'insieme cambia senza
    che il test sia aggiornato. Nessuno di questi insiemi contiene una voce che valuti
    persone o stati d'animo (`AGENTS.md` §8.2).
13. La configurazione dello `ScrumAgent` non espone alcun campo riferito a una singola
    persona identificata: un test verifica che lo schema di configurazione non contenga
    riferimenti a `Person` né punteggi individuali.
14. Abilitare una skill il cui livello di autonomia minimo supera quello dell'agente è
    rifiutato con errore di validazione.
15. Abbassando il livello di autonomia sotto il minimo di una skill già abilitata, la skill
    risulta disabilitata dopo il salvataggio e la risposta elenca le skill disattivate.

**Gateway LLM**

16. Con `LLM_PROVIDER=fake` nessuna richiesta di rete lascia il processo: un test che
    intercetta le chiamate uscenti fallisce se ne parte una. L'intera suite `npm run test`
    passa senza alcuna chiave API configurata.
17. Con lo stesso input, il provider fittizio restituisce lo stesso output e lo stesso
    conteggio di token: due esecuzioni consecutive producono `SkillRun` con identici token e
    costo.
18. Nessun modulo fuori da `src/lib/llm` importa l'SDK del modello: la violazione è
    intercettata da `npm run verify`.
19. Se i token stimati per la richiesta superano il `TokenBudget`, l'esecuzione non viene
    inviata al fornitore e produce un `SkillRun` con esito `failed`, causa `budget_exceeded`
    e token consumati pari a 0.
20. Se il fornitore primario risponde con indisponibilità o limite di frequenza e un
    fornitore di riserva è configurato, il gateway ritenta **una sola volta** sulla riserva;
    il `SkillRun` registra il fornitore effettivamente usato. Se anche la riserva fallisce,
    l'esito è `failed` con causa `provider_unavailable` (o `rate_limited`) e nessuna
    eccezione risale all'interfaccia.
21. Se l'output del fornitore non rispetta lo schema atteso, il gateway ritenta una sola
    volta; al secondo fallimento l'esito è `failed` con causa `invalid_output`. Nessun testo
    non validato viene mostrato o salvato come risultato.
22. La richiesta costruita per `configuration-check` contiene la lingua configurata
    sull'agente: cambiando la lingua da `it` a `en` la richiesta catturata dal provider
    fittizio cambia di conseguenza.
23. La richiesta costruita per `configuration-check` **non contiene** alcun valore proveniente
    da working agreement, Definition of Done, stakeholder, nomi di `Person`, titoli o
    descrizioni di `WorkItem`: verificato ispezionando la richiesta catturata dal provider
    fittizio dopo aver popolato tutti quei campi con stringhe riconoscibili.

**Registro delle esecuzioni**

24. Ogni esecuzione che raggiunge il gateway produce **esattamente un** `SkillRun`, sia in
    caso di successo sia di fallimento, contenente: organizzazione, progetto, agente, chiave
    di skill, trigger, istante di inizio e di fine, durata in millisecondi, esito, causa in
    caso di fallimento, fornitore, modello, token in ingresso e in uscita, costo stimato.
25. Un tentativo di eseguire una skill dichiarata ma non ancora disponibile (`sprint-report`,
    `daily-digest`, …) è rifiutato **prima** del gateway, non produce alcun `SkillRun` e non
    consuma token.
26. Superato il tetto giornaliero di esecuzioni della policy, l'esecuzione è rifiutata con un
    `SkillRun` di esito `failed` e causa `quota_exceeded` (il rifiuto è una decisione del
    runtime e va tracciata), con token pari a 0.
27. Il costo di un `SkillRun` è calcolato dal codice a partire dai token e da un listino
    versionato nel repository; con fornitore `fake` il costo è esattamente 0. Nessun valore
    di costo proviene mai da un modello (R1, ADR-0002).
28. Il registro restituisce solo le esecuzioni dell'organizzazione richiedente, ordinate per
    istante di inizio decrescente, e ne mostra al massimo 50 per pagina.
29. Su un agente `suspended`, ogni tentativo di esecuzione produce un `SkillRun` `failed` con
    causa `agent_suspended` e nessuna chiamata al fornitore.

**Percorso dimostrabile**

30. Un test end-to-end parte dalla pagina del progetto, completa il wizard **senza digitare
    alcun testo** (accettando i valori proposti), atterra sulla scheda dell'agente, esegue
    "Verifica configurazione" e vede la nuova riga in cima al registro. Il percorso ha
    esattamente 4 passi di wizard e non più di 12 interazioni, e il test completa in meno di
    60 secondi.

## 7. Casi limite

| Caso | Comportamento atteso |
|---|---|
| Nessun dato disponibile (progetto appena creato, nessuno sprint, nessun work item) | Il wizard funziona integralmente. La durata dello sprint proposta è 14. La scheda mostra l'avviso «nessun dato ingerito: le skill di T4 non avranno numeri da raccontare», informativo e non bloccante. |
| Sprint vuoto (sprint esistente ma senza work item) | Concorre comunque alla mediana delle durate: la durata di uno sprint esiste anche senza contenuto. Nessun errore, nessuna esclusione silenziosa. |
| Fonte esterna non raggiungibile (in T3 la fonte esterna è il **fornitore LLM**) | Si tenta la riserva una sola volta; se fallisce, `SkillRun` `failed` con causa `provider_unavailable` o `timeout`, messaggio esplicito nell'interfaccia, agente e configurazione intatti. |
| Progetto senza integrazioni configurate | Creazione e configurazione pienamente consentite: lo `ScrumAgent` non dipende da un'integrazione. La scheda dichiara che l'unica fonte è il connettore `seed`. |
| Dati parziali o incoerenti (durate di sprint molto diverse, sprint con date non valide) | Gli sprint con date non valide sono esclusi dal calcolo della mediana; se ne restano meno di due, la proposta torna a 14. Il valore è presentato come **proposta modificabile**, mai come verità. |
| Chiave API assente con `LLM_PROVIDER=gemini` | Creazione e modifica dell'agente restano possibili. L'esecuzione fallisce con causa `provider_not_configured` e un messaggio che indica quale variabile manca, senza mai stamparne il valore. |
| Fornitore lento oltre il timeout | `SkillRun` `failed`, causa `timeout`, durata effettivamente registrata; nessuna richiesta lasciata pendente. |
| Limite di frequenza del fornitore (429) | Si tenta la riserva; se assente o anch'essa limitata, causa `rate_limited` con invito a riprovare più tardi. |
| Testo di prompt injection incollato nel working agreement, nella Definition of Done o nel ruolo di uno stakeholder («ignora le istruzioni precedenti e …») | Salvato **come dato**, senza interpretazione. In T3 non raggiunge alcun prompt (criterio 23). Il caso entra nella suite avversariale come regressione permanente per T4 (`AGENTS.md` §8.1). |
| Skill abilitata la cui chiave sparisce dal catalogo in un rilascio successivo | La chiave sconosciuta è ignorata in lettura e segnalata sulla scheda come «skill non più disponibile». Il caricamento dell'agente non fallisce. |
| Stakeholder duplicati (stesso ruolo e stesso pubblico) | Errore di validazione sulla voce duplicata, con indicazione della riga. Nessuna deduplicazione silenziosa. |
| Utente rimosso dall'organizzazione mentre il wizard è aperto | La conferma finale è rifiutata come «non autorizzato»; nessuna scrittura. |
| Due utenti modificano la stessa sezione contemporaneamente | Il secondo salvataggio è rifiutato con conflitto e invito a ricaricare; nessuna sovrascrittura silenziosa. |
| Progetto archiviato dopo la creazione dell'agente | Scheda in sola lettura, esecuzioni rifiutate; il registro storico resta consultabile. |
| Cold start del database (Neon in scale-to-zero) | La pagina mostra lo stato di caricamento; superato il timeout mostra un errore ritentabile, non una pagina bianca. |
| Doppio clic su «Verifica configurazione» | Il pulsante si disabilita durante l'esecuzione: due `SkillRun` nascono solo se l'utente avvia due esecuzioni distinte in sequenza. |

## 8. Vincoli

- [x] **I numeri sono calcolati in `src/metrics`, non dall'LLM (ADR-0002).** In T3 gli unici
  numeri prodotti sono la durata mediana degli sprint (dal codice, sui `Sprint` canonici) e
  il costo di un `SkillRun` (dai token e da un listino versionato). Nessun modello somma,
  media o stima alcunché.
- [x] **Passa dal modello canonico, nessun formato nativo esterno (ADR-0003).** L'unica
  lettura di dominio è su `Sprint` canonici. Nessun accesso a formati di sorgenti esterne.
- [x] **Se usa un LLM: output vincolato a schema, budget di token dichiarato (ADR-0004).**
  `configuration-check` dichiara schema di input, schema di output, `TokenBudget` e autonomia
  minima; l'output è validato prima di qualsiasi uso, con un solo nuovo tentativo e poi
  degrado controllato.
- [x] **Se legge testo di terzi: trattato come dato non fidato (`AGENTS.md` §8.1).** Persona,
  working agreement, Definition of Done e stakeholder sono testo fornito da un umano e
  trattati come dato: in T3 non entrano in nessun prompt (criterio 23) e quando entreranno in
  T4 dovranno essere delimitati e dichiarati non fidati. Nessun tool scrivente è esposto.
- [x] **Nessuna metrica individuale, nessuna inferenza emotiva (`AGENTS.md` §8.2).** Il
  livello di autonomia governa *cosa l'agente può produrre*, non *chi può valutare*: nessun
  livello, nessuna policy e nessuna skill del catalogo abilita una valutazione su una
  persona o una deduzione sul suo stato d'animo. I divieti compaiono nell'interfaccia come
  policy non disattivabili, così che sia visibile che non sono una dimenticanza ma una
  scelta.
- [x] **Isolamento fra organizzazioni rispettato.** `ScrumAgent`, `ProjectContext` e
  `SkillRun` portano l'organizzazione e ogni lettura passa dall'helper condiviso di tenancy
  (`AGENTS.md` §8.4).
- [x] **Solo dati sintetici ai fornitori su piano gratuito (ADR-0005).** In T3 il rispetto è
  banale e verificato: la sola esecuzione ammessa non invia dati di progetto.

## 9. Impatto sull'interfaccia

**Schermate coinvolte**

1. **Pagina del progetto** (`/progetti/[slug]`): nuovo riquadro con lo stato dello Scrum
   Master AI — assente (con invito alla creazione) oppure presente (con collegamento alla
   scheda e ultima esecuzione).
2. **Wizard di creazione**: quattro passi con barra di avanzamento, navigazione avanti e
   indietro senza perdere i valori inseriti, conferma solo all'ultimo passo.
3. **Scheda dell'agente**: identità, contesto di progetto, capacità e policy, stato; azioni
   «Modifica», «Sospendi / Riattiva», «Verifica configurazione».
4. **Registro delle esecuzioni**: tabella con istante, skill, trigger, esito, fornitore,
   token, costo, durata.

**Stati**

- **Vuoto**: «Questo progetto non ha ancora uno Scrum Master AI», con l'azione di creazione;
  registro vuoto: «Nessuna esecuzione: prova la verifica di configurazione».
- **Caricamento**: scheletri sui riquadri (il cold start di Neon rende l'attesa reale, non
  teorica); durante l'esecuzione il pulsante è disabilitato con indicatore di avanzamento.
- **Errore**: messaggio in italiano che dice **cosa è successo e cosa fare** («Il fornitore
  non ha risposto in tempo. Riprova, oppure controlla la configurazione del provider»), con
  la causa tecnica accanto, mai un codice nudo. Nessun segreto e nessun valore di variabile
  d'ambiente compare nei messaggi.

I testi dell'interfaccia sono in italiano (`AGENTS.md` §7); la lingua configurata
sull'agente riguarda i **suoi** output, non l'applicazione.

## 10. Come si verifica

- **Test unitari**: valori predefiniti della configurazione; validazione di ogni campo e dei
  suoi limiti; rifiuto dei livelli di autonomia fuori perimetro; coerenza fra autonomia e
  skill abilitate; calcolo della durata mediana degli sprint (0, 1, 2, n sprint, date non
  valide); calcolo del costo dai token; chiusura degli insiemi di valori ammessi;
  determinismo del provider fittizio.
- **Test di integrazione**: creazione atomica e unicità per progetto; idempotenza del doppio
  invio; isolamento fra due organizzazioni; scrittura di un `SkillRun` per ogni esito;
  fallback al fornitore di riserva e successivo fallimento, con provider fittizio
  configurabile per fallire; superamento di budget e di tetto giornaliero; agente sospeso;
  assenza di traffico di rete con `LLM_PROVIDER=fake`.
- **Suite avversariale**: payload di prompt injection salvati nei campi di testo del contesto
  di progetto, con verifica che non compaiano nella richiesta inviata al fornitore.
- **Eval (se coinvolge un LLM)**: **nessuna in T3.** Non c'è narrazione di numeri da
  valutare; le eval nascono con la prima skill di T4. Dichiarato qui perché la sua assenza
  sia una scelta registrata e non una dimenticanza.
- **Verifica manuale**: dalla dashboard di un progetto popolato dal connettore `seed`,
  creazione dell'agente accettando i valori proposti, esecuzione della verifica di
  configurazione, controllo della riga nel registro. Cronometrata: deve stare sotto i due
  minuti.
- `npm run verify` verde, incluso il controllo dei confini architetturali
  (`app → agents → metrics → domain`) e l'assenza di importazioni dirette dell'SDK fuori da
  `src/lib/llm`.

## 11. Questioni aperte

Domande a cui **solo il Product Owner** può rispondere: sono decisioni di prodotto o di
dominio, non dubbi tecnici. Accanto a ciascuna c'è il comportamento provvisorio adottato
nella spec, così che l'implementazione non resti bloccata.

- [ ] **Q1 — Il livello `advise` è selezionabile in T3?** La roadmap esclude esplicitamente
  `act_with_approval` e `autonomous`, ma dice anche «il PoC si ferma a `report`», il che
  lascia `advise` in mezzo. `advise` significa «propone azioni in privato allo Scrum Master
  umano»: senza un canale privato (T5) rischia di essere un'etichetta senza comportamento.
  *Provvisorio: ammessi solo `observe` e `report`.*
- [ ] **Q2 — La lingua predefinita è fissa o è un attributo dell'organizzazione?** Oggi
  `Organization` non ha un campo lingua; introdurlo è una scelta di prodotto (un gruppo
  multinazionale potrebbe volere progetti in lingue diverse da quella aziendale).
  *Provvisorio: predefinito `it`, sovrascrivibile per agente.*
- [ ] **Q3 — La persona è una scelta fra profili predefiniti o testo libero?** Un elenco
  chiuso (es. *facilitatore*, *analista di flusso*, *comunicatore verso stakeholder*) è più
  sicuro e più valutabile; il testo libero è più espressivo, ma entra in un prompt in T4 ed è
  quindi superficie di prompt injection anche da parte di un utente interno.
  *Provvisorio: elenco chiuso di profili predefiniti.*
- [ ] **Q4 — Chi può creare e modificare lo Scrum Master AI di un progetto?** I ruoli
  esistenti sono `owner`, `admin`, `member`, ma nessuna schermata li usa ancora per
  autorizzare. Va deciso se la configurazione dell'agente è un'operazione da amministratore o
  da qualsiasi membro. *Provvisorio: qualsiasi membro dell'organizzazione, per coerenza con
  la gestione attuale dei progetti.*
- [ ] **Q5 — Gli stakeholder possono contenere nomi di persone reali?** La spec prevede oggi
  solo ruolo + pubblico, senza nome, perché ADR-0005 vieta dati personali reali verso
  fornitori su piano gratuito e §8.2 impone persone fittizie. Se servono i nomi, va deciso se
  restano confinati all'interfaccia e mai inviati a un modello. *Provvisorio: nessun nome,
  solo ruolo e pubblico.*
- [ ] **Q6 — Quanto vale il tetto giornaliero di esecuzioni, ed è per agente o per
  organizzazione?** È la protezione contro l'esaurimento dei limiti gratuiti durante una
  dimostrazione, quindi la soglia dipende da come si intende dimostrare il prodotto.
  *Provvisorio: 50 esecuzioni al giorno per agente.*
- [ ] **Q7 — Uno Scrum Master AI si può eliminare, o solo sospendere?** I progetti si
  archiviano invece di cancellarsi, per non riscrivere la storia; la stessa logica varrebbe
  per l'agente, ma resta da decidere che ne è del registro delle esecuzioni. *Provvisorio: si
  sospende, non si elimina; il registro è conservato.*
- [ ] **Q8 — La verifica di configurazione, con un fornitore reale, consuma quota gratuita: è
  un costo accettabile a ogni salvataggio, o deve restare un'azione esplicita dell'utente?**
  *Provvisorio: azione esplicita, mai automatica al salvataggio.*
