# ADR-0002 — Le metriche si calcolano in codice, non con l'LLM

- **Stato:** accettato
- **Data:** 2026-08-19
- **Decisori:** Giuseppe Di Bari

## Contesto

Lo Scrum Master AI produce report, digest e segnalazioni densi di numeri: velocity,
burndown, cycle time, WIP, variazione di perimetro, metriche DORA.

Un modello linguistico è in grado di produrre questi numeri a partire da dati grezzi, e
la strada più rapida sarebbe passargli l'elenco dei work item chiedendogli il report
completo. È una tentazione forte perché fa risparmiare molto codice all'inizio.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — L'LLM calcola tutto dai dati grezzi | pochissimo codice, prototipo immediato | numeri non riproducibili, errori aritmetici silenziosi, costo alto, impossibile da testare |
| B — Il codice calcola, l'LLM narra | numeri esatti e testabili, costo basso, spiegabilità | serve un motore di metriche vero |
| C — Ibrido, l'LLM verifica il codice | ridondanza | complessità doppia, nessun beneficio reale |

## Decisione

**Il codice calcola, l'LLM racconta.**

Ogni valore numerico presente in un output è prodotto da `src/metrics`, funzione pura,
deterministica e coperta da test. L'LLM riceve i numeri **già calcolati** in un oggetto
strutturato e si limita a interpretarli, contestualizzarli e narrarli.

È vietato chiedere a un modello di calcolare, sommare, mediare, contare o stimare.

## Motivazione

La fiducia in questo prodotto è asimmetrica: si costruisce lentamente e si perde
istantaneamente. Un utente che trova un solo numero sbagliato in un report smette di
fidarsi dell'intero sistema, comprese le parti corrette — e in una demo di portfolio, chi
guarda cercherà esattamente quel tipo di errore.

Inoltre:

- Un calcolo in codice è **riproducibile e verificabile**; un output LLM non lo è.
- Le metriche di flusso hanno casi limite (item riaperti, aggiunti a metà sprint,
  transizioni fuori ordine, fusi orari) che richiedono decisioni esplicite e testate,
  non un'interpretazione statistica del modello.
- Passare migliaia di record al modello costa molto e satura la finestra di contesto,
  proprio mentre serve spazio per il ragionamento.
- Un motore di metriche deterministico produce valore **anche senza LLM**: la dashboard
  è già dimostrabile prima che esista una sola chiamata a un modello.

## Conseguenze

**Positive**
- I numeri sono difendibili e ogni valore è riconducibile alla sua formula.
- Le metriche restano testabili con test unitari veloci e senza rete.
- Costo per esecuzione molto più basso.
- Cambiare modello LLM non altera i numeri.

**Negative / costi accettati**
- Va scritto e mantenuto un vero motore di metriche prima delle funzionalità appariscenti.
- Ogni nuova metrica richiede una definizione operativa esplicita nel glossario.

**Vincoli che ne derivano per il codice**
- `src/metrics` è puro: nessun I/O, nessuna chiamata di rete, nessuna dipendenza da
  framework. Input dati, output numeri.
- Ogni skill dichiara i numeri che userà e li riceve come input strutturato tipizzato.
- Il prompt di ogni skill contiene l'istruzione esplicita di non ricalcolare né
  arrotondare i valori ricevuti.
- Esiste una eval che verifica che ogni numero citato nel testo generato sia presente
  nell'input: se il modello inventa una cifra, la valutazione fallisce.
- Ogni metrica ha test per: insieme vuoto, item riaperto, item aggiunto a sprint in
  corso, transizioni non ordinate, sprint di un solo giorno.

## Quando riconsiderare

Mai per le metriche numeriche. La decisione può essere rivista solo per grandezze
intrinsecamente qualitative (per esempio la classificazione tematica di un insieme di
commenti), che comunque non devono mai essere presentate come numeri precisi.
