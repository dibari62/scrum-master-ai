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

### Q1 — `in_review` conta come stato attivo?

**Dove si è manifestata.** Scrivendo `flowEfficiency` in `src/metrics`.

**Il conflitto.** Il glossario definisce `wip` come «work item contemporaneamente
in stati attivi (`in_progress`, `in_review`)», quindi `in_review` è attivo. Ma
definisce anche `flowEfficiency` come «tempo in stati attivi ÷ tempo totale di
attraversamento», e con quella lista **un collo di bottiglia in revisione diventa
invisibile**: un elemento che passa da `in_progress` a `in_review` a `done` senza
mai bloccarsi ottiene efficienza 1, anche se è rimasto quattro giorni in attesa
che qualcuno lo guardasse.

Verificato sui dati sintetici: l'efficienza mediana è esattamente 1 mentre
l'attesa in revisione cresce da ore a giorni.

**Perché non l'ho deciso io.** Le due definizioni servono scopi diversi e
entrambe le letture sono difendibili:

- `in_review` **è** lavoro in corso — occupa una posizione nel flusso, e per
  questo conta nel WIP;
- `in_review` **è** attesa — nessuno ci sta lavorando finché un revisore non lo
  apre.

Il modello canonico non distingue «in attesa di revisione» da «in revisione»,
perché quasi nessuna fonte espone quella differenza.

**Opzioni.**

1. **Lasciare com'è.** `flowEfficiency` misura «nel flusso ÷ totale» e scende
   solo con `blocked`. Il collo di bottiglia si legge in `reviewWaitTime`, che
   lo misura direttamente. Costo: un cruscotto che mostra «efficienza 100%» a
   una squadra sommersa dalle revisioni.
2. **Escludere `in_review` dagli stati attivi** ai soli fini di
   `flowEfficiency`, lasciandolo nel WIP. Costo: due definizioni di «attivo»
   nello stesso sistema, da spiegare ogni volta.
3. **Aggiungere uno stato canonico** `review_wait`. Costo: i connettori devono
   saperlo dedurre, e quasi nessuna fonte lo espone.

**Stato:** in attesa di decisione. Nel frattempo vale l'opzione 1, che è la
lettura letterale del glossario, e il limite è dichiarato nel codice.


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
| `wip` | WIP | Work item contemporaneamente in stati attivi (`in_progress`, `in_review`) |
| `flowEfficiency` | Efficienza di flusso | Tempo in stati attivi ÷ tempo totale di attraversamento |
| `agingWorkItem` | Invecchiamento | Tempo trascorso nello stato attuale da un item non ancora concluso |
| `scopeChange` | Variazione di perimetro | Lavoro aggiunto o rimosso dallo sprint **dopo** l'inizio |
| `carryOver` | Lavoro trascinato | Work item non completati che passano allo sprint successivo |
| `reopenRate` | Tasso di riapertura | Quota di item che tornano da `done` a uno stato attivo |
| `blockedTime` | Tempo bloccato | Tempo cumulato in stato `blocked` |
| `reviewWaitTime` | Attesa in review | Tempo fra apertura della PR e primo commento di revisione |

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

---

## 5. Termini da non usare

| ❌ Evita | ✅ Usa |
|---|---|
| ticket, issue, story, task (come tipo generico) | `WorkItem` |
| stand-up | `DailyScrum` |
| azienda / cliente / tenant (nel codice) | `Organization` |
| status / stato del ticket | `WorkItemState` |
| agente (per lo Scrum Master del progetto) | `ScrumAgent` |
| sentiment | indicatore di processo aggregato |
| performance del team (come giudizio) | metrica di flusso |
