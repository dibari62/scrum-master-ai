# ADR-0004 — Le skill sono funzioni tipizzate, non agenti conversazionali

- **Stato:** accettato
- **Data:** 2026-08-19
- **Decisori:** Giuseppe Di Bari

## Contesto

Lo Scrum Master AI deve offrire capacità diverse: report di sprint, digest giornaliero,
salute dello sprint, colli di bottiglia, Q&A sul progetto, preparazione della
retrospettiva.

L'approccio oggi più pubblicizzato è un agente autonomo con accesso a un insieme di tool,
libero di decidere quali invocare e in quale ordine. È attraente da raccontare, ma
introduce non determinismo, costo variabile e difficoltà di test.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — Un agente autonomo con tool e ciclo di ragionamento | flessibile, "impressionante" | non deterministico, costo imprevedibile, difficile da valutare, superficie di prompt injection ampia |
| B — Skill come funzioni tipizzate, LLM usato in punti precisi | testabile, costo prevedibile, valutabile | meno "magia", ogni capacità va progettata |
| C — Grafo di stato per ogni capacità | controllo fine, ripresa dopo interruzione | complessità elevata dove non serve |

## Decisione

Ogni **`Skill`** è una funzione con firma esplicita:

```
(input validato da Zod) -> (output validato da Zod)
```

Al suo interno può esserci una o più chiamate a un modello, ma la **struttura del flusso
è codice**: raccolta dati, pre-filtro deterministico, calcolo metriche, chiamata LLM per
la sola narrazione, validazione dell'output.

Un grafo **LangGraph.js** si introduce **solo** quando una capacità richiede stato
durevole, ripresa dopo interruzione o approvazione umana intermedia. Non prima.

## Motivazione

Una skill deterministica nella struttura è **valutabile**: si può eseguire su un dataset
dorato e verificare proprietà oggettive (i numeri citati coincidono con l'input, lo schema
è rispettato, non compaiono nomi inventati). Un agente libero produce percorsi diversi a
ogni esecuzione ed è quindi impossibile da sottoporre a regressione — e senza regressione
ogni modifica a un prompt è un cambiamento a occhi chiusi.

Il costo è il secondo motivo: un ciclo di ragionamento libero può consumare un ordine di
grandezza in più di token per lo stesso risultato, e i piani gratuiti hanno limiti stretti.

Il terzo è la sicurezza: restringere le chiamate a modello a punti precisi, con tool
esposti minimi e output vincolati a schema, riduce drasticamente la superficie della
prompt injection indiretta (vedi `AGENTS.md` §8.1). Un agente libero con tool scriventi
che legge commenti scritti da terzi è un rischio non gestibile a questo livello di maturità.

Infine, la maggior parte delle capacità richieste **non ha bisogno** di autonomia: "genera
il report di questo sprint" è una pipeline, non un problema di pianificazione.

## Conseguenze

**Positive**
- Ogni skill è eseguibile in test con un provider LLM fittizio.
- Costo per esecuzione stimabile in anticipo.
- Le eval possono girare in continuo su un dataset dorato.
- Fallimenti localizzati e diagnosticabili.

**Negative / costi accettati**
- Ogni nuova capacità richiede progettazione esplicita: non emerge da sola.
- Meno adattabilità a richieste impreviste dell'utente (mitigato dalla skill di Q&A,
  che è l'unico punto legittimamente aperto).

**Vincoli che ne derivano per il codice**
- Ogni skill dichiara: schema di input, schema di output, budget massimo di token,
  livello di autonomia minimo richiesto.
- L'output del modello è **sempre** validato contro lo schema Zod prima dell'uso; in caso
  di fallimento si ritenta una volta e poi si degrada in modo controllato.
- L'accesso al modello passa esclusivamente dal gateway in `src/lib/llm`, che gestisce
  provider, fallback, budget e tracciamento del costo. Nessuna chiamata diretta all'SDK
  altrove.
- Nessuna chiamata di rete a un LLM nei test unitari né in CI: si usa il provider fittizio.
- Le skill consumano i risultati di `src/metrics`; non ricalcolano nulla (ADR-0002).
- Il pre-filtro dei dati è deterministico: al modello arrivano gli elementi rilevanti
  selezionati dal codice, non l'intero corpus.

## Quando riconsiderare

Quando una capacità richiederà genuinamente pianificazione dinamica su più passi con
approvazione umana intermedia — realisticamente la preparazione della retrospettiva o
l'inoltro delle azioni di follow-up. In quel caso si introduce un grafo **per quella
skill**, senza convertire le altre.
