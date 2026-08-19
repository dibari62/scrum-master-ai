# ADR-0003 — Modello canonico come cuore del sistema

- **Stato:** accettato
- **Data:** 2026-08-19
- **Decisori:** Giuseppe Di Bari

## Contesto

Il valore percepito del prodotto sta nella capacità di correlare fonti diverse
(strumento di gestione attività, comunicazione, codice, rilasci) in un'unica narrazione
di sprint. Ogni fonte ha un modello dati proprio, incompatibile con le altre:

- Jira ha stati configurabili per progetto e story point in un campo personalizzato.
- Azure DevOps ha work item type e area path.
- GitHub Projects ha campi arbitrari definiti dall'utente.
- Slack ha thread e reazioni.

Con dieci skill e più fonti, la combinatoria esplode: senza un livello intermedio si
scrivono adattamenti specifici dentro ogni skill.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — Ogni skill legge direttamente dalle fonti | nessuna astrazione da progettare, prima skill velocissima | ogni nuova fonte moltiplica il lavoro per il numero di skill; logica duplicata; impossibile correlare |
| B — Modello canonico intermedio | una traduzione per fonte, skill indipendenti dall'origine | va progettato bene fin dall'inizio; rischio di astrazione prematura |
| C — Solo storage grezzo + RAG | massima flessibilità sui testi | nessuna metrica affidabile: incompatibile con ADR-0002 |

## Decisione

Adottiamo un **modello canonico Scrum** in `src/domain`, definito con schemi Zod, verso
cui ogni connettore traduce. Nessun componente a valle conosce il formato nativo delle
fonti.

Entità canoniche principali: `Sprint`, `WorkItem`, `WorkItemState`, `StateTransition`,
`Board`, `Person`, `Comment`, `Message`, `Meeting`, `Decision`, `Impediment`,
`PullRequest`, `Deployment`, `Incident`. Definizioni vincolanti nel
[glossario di dominio](../domain-glossary.md).

## Motivazione

Il costo dell'opzione A cresce come *fonti × skill*; quello dell'opzione B come
*fonti + skill*. Con l'obiettivo dichiarato di dimostrare più capacità su più fonti, la
differenza diventa decisiva già al secondo connettore.

Il modello canonico produce inoltre tre effetti che valgono da soli la scelta:

1. **Sviluppo senza integrazioni reali.** Un connettore "seed" che genera dati sintetici
   soddisfa lo stesso contratto di uno reale: si costruiscono metriche, dashboard e skill
   prima di aver ottenuto una singola credenziale OAuth. Per un PoC è la differenza fra
   partire oggi e partire fra due settimane.
2. **Correlazione.** Una pull request e un work item diventano confrontabili solo se
   espressi in un vocabolario comune.
3. **Sostituibilità.** Aggiungere Azure DevOps dopo Jira costa un adapter, non un
   rifacimento.

`StateTransition` è deliberatamente un'entità di primo livello e non un dettaglio: quasi
tutte le metriche di flusso derivano dalla storia dei passaggi di stato, non dallo stato
attuale. Una fonte che espone solo lo stato corrente va integrata campionando o leggendo
lo storico dei cambiamenti — non è un dettaglio implementativo rimandabile.

## Conseguenze

**Positive**
- Skill e metriche scritte una volta sola, valide per ogni fonte.
- Sviluppo e test senza rete, su fixture e dati sintetici.
- Confini netti fra i moduli: più agenti possono lavorare in parallelo senza collidere.

**Negative / costi accettati**
- Perdita di informazione: le peculiarità di ogni strumento vanno mappate o scartate.
- Serve una decisione esplicita sulla mappatura degli stati per ogni fonte.
- Il modello va progettato prima di vedere la seconda fonte reale: qualche revisione è
  attesa e va gestita con migrazioni.

**Vincoli che ne derivano per il codice**
- `src/domain` non importa nulla dagli altri livelli e non dipende da alcun framework.
- Il formato nativo di una fonte esiste **solo** dentro `src/connectors/<fonte>/`.
  Un tipo `JiraIssue` fuori da lì è un errore bloccante in review.
- Ogni connettore implementa la stessa interfaccia e viene validato dalla stessa suite
  di conformità, eseguita su fixture registrate.
- Ogni entità canonica conserva `sourceId` e `sourceSystem` per la tracciabilità.
- La mappatura degli stati nativi verso `WorkItemState` è dichiarativa e configurabile
  per progetto, non incorporata nel codice.

## Quando riconsiderare

Se dopo tre connettori reali il modello richiede campi specifici per fonte in più del
20% delle entità, significa che l'astrazione è sbagliata e va rinegoziata.
