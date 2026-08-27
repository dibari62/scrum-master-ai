# ADR-0009 — Da quale strumento esterno si parte, e che cosa se ne può davvero prendere

- **Stato:** proposto
- **Data:** 2026-08-27
- **Decisori:** Product Owner

## Contesto

Il portale calcola metriche corrette su dati **sintetici**. Il passo che lo rende
un prodotto invece di una dimostrazione è leggere da uno strumento vero: Jira o
Azure DevOps.

La domanda non è «come si chiama l'endpoint». È più severa, e riguarda R1:

> **Le nostre metriche possono esistere sui dati che quelle piattaforme
> espongono?**

Tre delle nostre entità non sono fotografie ma **storie**, e sono precisamente
quelle su cui il libro fonda i suoi numeri:

- `StateTransition` — la velocity conta ciò che era `done` *alla chiusura*, e il
  cycle time misura fra due passaggi. Con il solo stato corrente entrambi sono
  irrecuperabili (ADR-0003).
- `EstimateChange` — la velocity usa la stima **all'ingresso nello sprint**, non
  quella di oggi (ADR-0008).
- `SprintScopeEvent` — quando un elemento è entrato o uscito da uno sprint.

Se una piattaforma non le espone, non è un connettore più difficile: è un
connettore che **non può alimentare le metriche del libro**, e andrebbe saputo
prima di scrivere codice, non dopo.

La ricerca è in `files/ricerca-connettori.md` della sessione, con le citazioni
alla documentazione ufficiale.

## Che cosa la ricerca ha stabilito

| Serve a | Jira Cloud | Azure DevOps |
|---|---|---|
| Storia degli stati | ✅ `GET /issue/{key}/changelog` | ✅ `GET /workitems/{id}/updates` |
| Storia delle stime | ✅ stesso changelog | ✅ stesse updates, campo fisso |
| Ingresso/uscita da uno sprint | ✅ campo `Sprint` nel changelog | ✅ `System.IterationPath` nelle updates |
| Data di chiusura reale dello sprint | ✅ `completeDate` | ⚠️ **assente**: solo `finishDate` pianificata |
| Obiettivo dello sprint | ✅ campo `goal` | ⚠️ **assente** come campo |
| Categoria di stato per la mappatura | ✅ `statusCategory.key` | ✅ `category` |
| Importazione incrementale | ⚠️ JQL `updated >= data` | ✅ `continuationToken` nativo |

**La risposta alla domanda severa è sì per entrambe.** Le tre storie critiche
sono recuperabili, e questo è il fatto che rende il progetto realizzabile.

### Quattro cose che **non** si possono avere

1. **`SprintScopeEvent.reason` sarà sempre `null`.** Né Jira né Azure DevOps
   distinguono un'aggiunta voluta da un'interruzione. Il modello lo prevede già
   con tre stati, e la scelta — presa il 27 agosto per principio — risulta
   l'unica compatibile con un connettore reale: se avessimo modellato due stati,
   ogni interruzione sarebbe stata registrata come «pianificata».
2. **`Sprint.completedAt` su Azure DevOps** non esiste come dato distinto. Il
   connettore dovrà usare la data pianificata, perdendo il segnale «chiuso in
   ritardo».
3. **`Sprint.goal` su Azure DevOps** non esiste come campo strutturato.
4. **Il campo Story Points di Jira ha un identificativo diverso per ogni
   istanza.** Va scoperto con `GET /rest/api/3/field` all'avvio: non è
   scrivibile nel codice.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **A. Prima Jira** | changelog è un endpoint dedicato; `Sprint` è un'entità con `goal` e `completeDate` già pronti; è lo strumento più diffuso fra i team che praticano Scrum | il campo delle stime va scoperto per istanza |
| **B. Prima Azure DevOps** | campo stime a nome fisso; `continuationToken` è un flusso di modifiche nativo, superiore per volumi grandi | manca la data di chiusura reale e manca l'obiettivo: **due entità del nostro modello nascerebbero incomplete** |
| **C. Entrambi insieme** | l'astrazione nasce su due casi e non su uno | doppio lavoro prima di aver visto funzionare *un* connettore su dati veri |
| **D. Un adapter generico configurabile** | un solo connettore per tutti | si progetta l'astrazione prima di conoscere le differenze: è il modo classico per ottenerne una sbagliata |

## Decisione

**Si parte da Jira Cloud.** Azure DevOps viene dopo, e sarà il secondo caso su
cui l'astrazione — se servirà — verrà estratta.

## Motivazione

**Perché non Azure DevOps per primo.** Non per difficoltà tecnica: per il
modello. Su ADO `Sprint.completedAt` e `Sprint.goal` sarebbero `null`, quindi il
primo connettore vero produrrebbe uno sprint **strutturalmente più povero** di
quello sintetico che già abbiamo. Il rischio non è tecnico ma di giudizio: si
finirebbe per credere che quei campi siano opzionali, e a indebolire il modello
per farceli stare.

**Perché non entrambi insieme.** L'astrazione giusta si riconosce quando si sono
visti due casi, non quando se ne immaginano due. Scriverla ora significherebbe
progettarla sulle *nostre supposizioni* sulle differenze, e la ricerca ha già
mostrato che alcune non le avremmo indovinate — il campo stime a nome variabile,
per dirne una.

**Perché non un adapter generico.** È l'errore che ADR-0003 previene sul versante
opposto: il modello canonico esiste perché nessuna skill veda mai un formato
nativo. Un adapter configurabile spingerebbe la configurazione a diventare un
secondo linguaggio, e le peculiarità di Jira finirebbero in un file YAML invece
che in codice leggibile e testato.

**Perché Jira regge il confronto sul punto che conta.** Il changelog è un
endpoint di prima classe con paginazione propria; le `updates` di ADO sono un
modello a revisioni delta, corretto ma più laborioso da consumare. Per il primo
connettore la semplicità di lettura vale più dell'efficienza di importazione.

## Conseguenze

**Positive**

- Il primo connettore vero popola **ogni** campo del modello canonico, e quindi
  lo mette alla prova per intero invece di aggirarne le parti scomode.
- La suite di conformità dei connettori — che già esiste ed è usata dal seed —
  diventa il contratto che Jira deve superare. Non va inventata: va soddisfatta.
- La scelta dei tre stati di `reason` risulta confermata da un vincolo esterno,
  non solo da un ragionamento nostro.

**Negative / costi accettati**

- Azure DevOps resta indietro. Per un'organizzazione già dentro Microsoft 365 è
  la scelta naturale, e per un po' non sarà servita.
- Il campo Story Points va scoperto a ogni avvio: una chiamata in più e un caso
  d'errore in più («l'istanza non ha un campo Story Points»).

**Vincoli che ne derivano per il codice**

- Il connettore Jira sta in `src/connectors/jira/` e **traduce solo verso il
  canonico**. Nessun tipo Jira esce da quella cartella (R2).
- La mappatura fra stati Jira e stati canonici è **dichiarativa e per progetto**,
  mai codice sparso: gli stati sono configurabili per progetto, e `statusCategory`
  serve solo a proporre un valore predefinito.
- I test usano **fixture registrate**, mai chiamate di rete: è già la regola per
  i connettori (§6).
- Nessun segreto nel codice: il token vive in `.env.local` e nelle variabili
  d'ambiente della piattaforma (§8.3).
- Il testo che arriva da Jira — titoli, descrizioni, commenti — è **contenuto non
  fidato** (§8.1), esattamente come quello del seed.

## Quando riconsiderare

- Se un'organizzazione che vuole usare il portale **usa Azure DevOps e non Jira**:
  la priorità si inverte, e i due campi mancanti diventano un problema da
  affrontare invece che da rimandare.
- Se il changelog di Jira si rivelasse troppo lento da percorrere per progetti
  grandi — una chiamata per elemento — la strategia di importazione va rivista
  prima della scelta della piattaforma.
- Se Atlassian rendesse a pagamento l'accesso API sul piano gratuito: il
  proof-of-concept a costo zero non reggerebbe più (ADR-0001).
