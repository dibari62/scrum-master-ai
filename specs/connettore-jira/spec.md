# Spec — Connettore Jira Cloud

- **Stato:** bozza
- **Autore:** agente Connector, su ricerca sulle API ufficiali
- **Data:** 2026-08-27
- **Traguardo di roadmap:** primo connettore verso uno strumento reale
- **Decisione a monte:** [ADR-0009](../../docs/architecture/ADR-0009-primo-connettore.md)

---

## 1. Problema

Il portale calcola metriche fedeli al libro su dati **sintetici**. Sono corretti e
verificati, ma nessuno li ha vissuti: nessuna squadra riconosce il proprio sprint
guardandoli.

Finché la sola fonte è il seed, lo Scrum Master AI resta una dimostrazione di
aritmetica. Il passo che lo rende un prodotto è leggere da Jira Cloud, che è lo
strumento che la maggior parte dei team Scrum usa davvero.

> **Perché questo è il momento giusto e non prima.** Il modello canonico esiste,
> è passato attraverso quaranta metriche e un libro intero, e ha già una suite di
> conformità che il connettore sintetico supera. Il connettore Jira non deve
> inventare un contratto: deve **soddisfarne uno che esiste già**. Farlo prima
> avrebbe significato modellare il canonico su Jira, che è esattamente ciò che
> ADR-0003 vieta.

## 2. Risultato atteso

Un amministratore collega un progetto del portale a una board Jira. Da quel
momento le pagine che oggi mostrano numeri sul progetto sintetico mostrano gli
stessi numeri sul progetto vero: velocity, burndown, cycle time, salute dello
sprint, scaletta della demo.

**Nessuna pagina, metrica o skill cambia.** Se qualcosa a valle deve cambiare per
far entrare Jira, il modello canonico era sbagliato — ed è il vero collaudo di
questa fase.

## 3. Perimetro

**Incluso**

- Autenticazione con **API token** (Basic Auth), letto dalle variabili d'ambiente.
- Lettura di: campi personalizzati, board, sprint, issue, changelog.
- Traduzione verso `Person`, `Board`, `BoardColumn`, `Sprint`, `WorkItem`,
  `StateTransition`, `EstimateChange`, `SprintScopeEvent`, `Comment`.
- Ricostruzione delle **tre storie** che le metriche richiedono: stati, stime,
  appartenenza allo sprint.
- Scoperta a runtime del `fieldId` di Story Points, che varia per istanza.
- Mappatura degli stati Jira verso i canonici, **dichiarativa e per progetto**,
  con un valore predefinito proposto da `statusCategory`.
- Paginazione, `429` con `Retry-After`, importazione incrementale via JQL
  `updated >= …`.
- Test su **fixture registrate**: JSON di risposta salvati su file.

**Escluso** *(sezione obbligatoria)*

- **Qualsiasi scrittura verso Jira.** Il connettore è di sola lettura, e non
  espone alcun metodo che possa scrivere. È anche ciò che chiude il vettore di
  §8.1: un testo ingerito non può innescare una scrittura che non esiste.
- OAuth 3LO. È il metodo corretto per un'app distribuita e sbagliato per un PoC:
  richiede un'app registrata sul Developer Console e un giro di consensi.
- Jira Server / Data Center: le API differiscono, e non ne abbiamo un'istanza.
- Azure DevOps: è il secondo caso, e ADR-0009 spiega perché non insieme.
- Webhook e sincronizzazione in tempo reale. Si sincronizza a richiesta o dal job
  schedulato che già esiste.
- `Retrospective`, `ImprovementAction`, `SprintStatistics`, `Impediment`,
  `PullRequest`: Jira non li espone come artefatti, e il contratto già dichiara
  che restano vuoti per una fonte che non li tiene.
- L'interfaccia di configurazione. Questa spec arriva fino al connettore e alla
  sua configurazione validata; la pagina che la compila è un lavoro successivo.

## 4. Comportamento

### Percorso principale

1. Il progetto dichiara la propria configurazione Jira: dominio del sito, chiave
   del progetto Jira, identificativo della board, mappatura degli stati.
2. Il connettore scopre i campi dell'istanza (`GET /rest/api/3/field`) e trova
   quello di Story Points cercandolo per nome.
3. Legge gli sprint della board (`GET /rest/agile/1.0/board/{id}/sprint`).
4. Legge le issue del progetto con JQL, pagina per pagina. Su una richiesta
   incrementale la JQL porta `updated >= {since}`.
5. Per ogni issue legge il changelog (`GET /rest/api/3/issue/{key}/changelog`).
6. **Traduce**, con una funzione pura, il JSON in un `CanonicalBatch`.
7. Il batch entra nella riconciliazione già esistente, che chiave su
   `(organizzazione, sistema, sourceId)` e quindi ripete senza duplicare.

### Come si ricostruiscono le tre storie

Il changelog di Jira registra i **cambiamenti**, non gli stati. Ogni storia si
ricostruisce allo stesso modo: si parte da ciò che l'issue è **oggi** e si
cammina all'indietro.

| Storia | Voci del changelog | Da cui si ricava |
|---|---|---|
| Stati | `field = "status"` | una `StateTransition` per voce; lo stato iniziale è il `fromString` della **prima** voce, o lo stato attuale se non ce ne sono |
| Stime | `fieldId = {campo Story Points}` | un `EstimateChange` per voce; il valore iniziale è il `from` della prima voce, o quello attuale se non ce ne sono |
| Sprint | `field = "Sprint"` | il **delta fra due insiemi**, non un singolo valore — vedi sotto |

**Il campo Sprint contiene una lista, non un valore.** Una issue può stare in più
sprint, e Jira scrive `from: "12, 13"` → `to: "12"`. Leggerlo come un valore
singolo produrrebbe eventi sbagliati appena una storia viene trascinata avanti,
che è precisamente il caso che le nostre metriche misurano. Si calcola quindi la
differenza fra i due insiemi: ciò che entra genera un `added`, ciò che esce un
`removed`.

**Se una issue non ha alcuna voce nel changelog** per una di queste storie,
l'emissione è **una sola**, datata alla creazione dell'issue, con il valore
attuale. È una risposta completa a ciò che la fonte espone, non un ripiego: il
contratto lo dice già per le stime, e le altre due seguono la stessa regola.

### Percorsi alternativi

- **Nessun campo Story Points nell'istanza**: la sincronizzazione riesce, gli
  elementi arrivano senza stima, e la configurazione riporta l'assenza. Le
  metriche di stima diventeranno `unavailable`, che è già il comportamento
  previsto.
- **Uno stato Jira non è nella mappatura**: si usa `statusCategory` come ripiego
  e si segnala. Rifiutare l'intera sincronizzazione per uno stato nuovo
  significherebbe che aggiungere una colonna alla board spegne il portale.
- **`429`**: si attende quanto dice `Retry-After` e si riprova, con un numero
  massimo di tentativi. Superato quello, la sincronizzazione fallisce con un
  errore che dice cosa è successo.

## 5. Dati coinvolti

| Entità | Lettura | Scrittura | Note |
|---|---|---|---|
| `Person` | Jira | canonico | `accountId` → `sourceId`. Nessuna metrica individuale (§8.2) |
| `Board`, `BoardColumn` | Jira | canonico | dalla configurazione della board |
| `Sprint` | Jira | canonico | `completeDate` → `completedAt`, `goal` → `goal` |
| `WorkItem` | Jira | canonico | tipo, titolo, stato, stima, `parentId` dall'epica |
| `StateTransition` | changelog | canonico | il dato su cui poggia quasi ogni metrica |
| `EstimateChange` | changelog | canonico | la velocity legge la stima all'ingresso nello sprint |
| `SprintScopeEvent` | changelog | canonico | `reason` sempre `null`: Jira non lo distingue |
| `Comment` | Jira | canonico | **contenuto non fidato** (§8.1) |
| Configurazione Jira del progetto | portale | portale | il token **non** vi si scrive: sta nell'ambiente |

Nessun concetto nuovo nel glossario: è il punto di questa fase.

## 6. Criteri di accettazione

1. Il connettore **supera la suite di conformità** `tests/connectors/conformance.ts`
   senza che la suite venga modificata per accoglierlo.
2. Nessun tipo Jira è esportato fuori da `src/connectors/jira/`; `npm run boundaries`
   resta verde.
3. La traduzione è una **funzione pura** da JSON registrato a `CanonicalBatch`:
   ogni test di traduzione gira senza rete e senza orologio.
4. Data una issue con changelog `To Do → In Progress → Done`, il connettore
   produce tre `StateTransition`, di cui la prima con `fromState = null`.
5. Data una issue con changelog stime `3 → 5` e valore attuale `5`, il connettore
   produce due `EstimateChange`: `null → 3` alla creazione e `3 → 5` all'istante
   registrato.
6. Data una issue il cui campo Sprint passa da `"12, 13"` a `"12"`, il connettore
   produce **un solo** `SprintScopeEvent`, `removed` sullo sprint 13.
7. Data una issue senza alcuna voce di changelog, il connettore produce
   esattamente un `EstimateChange` datato alla creazione, e nessuna transizione.
8. Due `fetch` con gli stessi argomenti producono record identici, `sourceId`
   compresi.
9. Un `429` con `Retry-After: 2` porta a una nuova richiesta e non a un errore.
10. Il campo Story Points viene individuato per nome fra `Story Points` e
    `Story point estimate`, non per identificativo scritto nel codice.
11. Nessun test contatta la rete: la suite gira scollegati.
12. Il token non compare in alcun file versionato; `.env.example` elenca le chiavi
    senza valori.

## 7. Casi limite

| Caso | Comportamento atteso |
|---|---|
| Nessun dato disponibile | Batch vuoto, non un errore: un progetto Jira appena creato è legittimo |
| Sprint vuoto | Lo sprint esiste nel batch senza elementi; le metriche lo dichiarano già `unavailable` |
| Fonte esterna non raggiungibile | Errore con contesto — quale endpoint, quale codice. Mai `catch` silenzioso (§7) |
| Progetto senza integrazioni configurate | La sincronizzazione non parte e lo dice; nessun batch parziale |
| Dati parziali o incoerenti | Uno stato non mappato usa il ripiego e viene segnalato; una issue senza stima resta senza stima |
| Campo Story Points assente | Sincronizzazione riuscita, elementi senza stima, assenza dichiarata |
| Issue creata già dentro uno sprint | Nessuna voce di changelog: un `added` datato alla creazione |
| Issue in più sprint contemporaneamente | Si calcola il delta fra insiemi, un evento per sprint entrato o uscito |
| Issue spostata fra due sprint in un colpo | Due eventi: un `removed` e un `added`, stesso istante |
| Changelog più lungo di una pagina | Si pagina fino in fondo; un changelog troncato produrrebbe una storia falsa |
| Stato rinominato in Jira | La mappatura è per nome: il rinominato diventa uno stato non mappato, con ripiego e segnalazione |
| Sprint senza obiettivo | `goal` a `null`, che il portale già mostra come «nessun obiettivo dichiarato» |
| Fuso orario | Jira restituisce `+0000` con offset; si converte in UTC al bordo, come tutto il resto (§7) |

## 8. Vincoli

- [x] I numeri sono calcolati in `src/metrics`, non dall'LLM (ADR-0002) — il
      connettore non calcola nulla, traduce.
- [x] Passa dal modello canonico, nessun formato nativo esterno (ADR-0003) — è
      l'oggetto stesso di questa spec.
- [ ] Se usa un LLM: non ne usa.
- [x] Se legge testo di terzi: trattato come dato non fidato (§8.1) — titoli,
      descrizioni e commenti da Jira sono scritti da persone fuori
      dall'organizzazione e passano per la stessa delimitazione del seed.
- [x] Nessuna metrica individuale, nessuna inferenza emotiva (§8.2) — le persone
      si importano per attribuire i commenti, mai per misurarle.
- [x] Isolamento fra organizzazioni rispettato — la configurazione Jira è per
      progetto, e il progetto appartiene a un'organizzazione.

## 9. Impatto sull'interfaccia

In questa fase nessuno: la configurazione si dichiara nell'ambiente e nel
database. La pagina che la compila arriva dopo, quando avremo visto una
sincronizzazione vera riuscire.

Lo stato che dovrà comunque essere raccontato quando quella pagina esisterà:
mai sincronizzato, in corso, riuscito con la data, fallito con il motivo.

## 10. Come si verifica

- **Test unitari**: la traduzione, su fixture registrate. Un file JSON per ogni
  forma di risposta, salvato in `tests/connectors/jira/fixtures/`.
- **Conformità**: `runConnectorConformance` con un client finto che serve le
  fixture. È la stessa suite del seed, non una versione ridotta.
- **Verifica manuale**: un'istanza Jira Cloud gratuita con un progetto Scrum,
  due sprint chiusi e uno aperto. Confronto della velocity calcolata dal portale
  con il rapporto di velocity di Jira, che è il controllo che vale più di tutti
  gli altri messi insieme.

## 11. Questioni aperte

- [ ] **Serve un'istanza Jira vera.** Il piano gratuito arriva a 10 utenti ed è
      sufficiente, ma va creato un account e generato un token: è un gesto che
      spetta al Product Owner, non a un agente.
- [ ] **La mappatura degli stati va compilata a mano la prima volta?** Il ripiego
      su `statusCategory` copre i tre stati principali, ma il nostro modello ne
      ha di più (per esempio la revisione). Proporre una mappatura e farla
      correggere, oppure chiederla vuota?
- [ ] **Quanto indietro si importa la prima volta?** Tutto lo storico può essere
      migliaia di issue, e il changelog costa **una chiamata per issue**. Un
      limite iniziale (ultimi N sprint) è prudente, ma taglia la storia che serve
      alle metriche di tendenza.
