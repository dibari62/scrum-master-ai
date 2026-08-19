---
applyTo: "src/metrics/**"
---

# Regole del motore metriche

Questo modulo produce ogni numero che l'utente vedrà. Vedi
[ADR-0002](../../docs/architecture/ADR-0002-metriche-deterministiche.md).

## Purezza

`src/metrics` è **puro**: input dati, output numeri.
Vietati: I/O, query al database, chiamate di rete, chiamate a LLM, dipendenze da
framework, lettura implicita dell'ora corrente. L'istante di riferimento si riceve come
parametro, altrimenti i test non sono riproducibili.

## Fonte dei calcoli

Le metriche derivano da `StateTransition`, **non** dallo stato corrente del work item:
lo stato corrente non conserva la storia e rende i numeri irriproducibili a posteriori.

## Definizioni

Ogni metrica ha una definizione operativa in
[`docs/domain-glossary.md`](../../docs/domain-glossary.md). Se è ambigua, la disambigui
lì **prima** di scrivere codice.

## Casi limite obbligatori nei test

insieme vuoto · item riaperto dopo `done` · item aggiunto a sprint in corso · item
rimosso dallo sprint · transizioni non ordinate · transizioni duplicate o con timestamp
identico · sprint di un solo giorno · item senza stima · item ancora aperto a fine sprint
· sprint a cavallo del cambio di ora legale

## Regole di calcolo

- Mai sommare unità di stima diverse: restituisci un risultato esplicitamente parziale.
- Divisione per zero: risultato che dichiara l'indisponibilità, mai `NaN`, mai `0` muto.
- Nessun arrotondamento qui: si arrotonda solo alla presentazione.
- Restituisci sempre anche la **numerosità** del campione su cui la metrica è calcolata.

## Vietato

Metriche di performance individuali (velocity per persona, conteggio commit, classifiche)
e qualsiasi punteggio di umore o stato emotivo. Si misura il processo, non le persone.
