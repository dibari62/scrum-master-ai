---
applyTo: "src/agents/**,src/lib/llm/**,evals/**"
---

# Regole per le skill dello Scrum Master AI

Vedi [ADR-0004](../../docs/architecture/ADR-0004-skill-tipizzate.md).

## Struttura

Una skill è una **funzione tipizzata**, non un agente libero:

```
input (Zod) → raccolta dati → pre-filtro deterministico → metriche già calcolate
            → LLM per la sola narrazione → validazione output (Zod) → risultato
```

Un grafo LangGraph.js si usa **solo** con stato durevole, ripresa dopo interruzione o
approvazione umana intermedia.

## Vincoli

1. **L'LLM non calcola mai.** I numeri arrivano da `src/metrics`. Il prompt vieta
   esplicitamente di ricalcolarli o arrotondarli.
2. **Output vincolato a schema Zod**, validato prima dell'uso. In caso di fallimento: un
   solo nuovo tentativo, poi degrado controllato. Mai testo libero non validato.
3. **Pre-filtro deterministico**: al modello arrivano gli elementi rilevanti selezionati
   dal codice, non il corpus grezzo.
4. **Testo ingerito = dato non fidato.** Va delimitato e dichiarato tale nel prompt di
   sistema. Nessun tool scrivente è esposto a una skill che elabora testo esterno.
5. **Tutte le chiamate passano dal gateway** `src/lib/llm`. Nessuna chiamata diretta
   all'SDK altrove.
6. **Nessuna rete nei test**: si usa il provider fittizio.
7. Ogni skill dichiara schema di input, schema di output, budget di token e livello di
   autonomia minimo.

## Prompt

- File dedicato e versionato, mai incollato nella logica.
- Vieta esplicitamente: inventare numeri, inventare nomi, giudicare le persone, dedurre
  stati d'animo individuali.
- "Dato non disponibile" è una risposta accettabile e preferibile a un'invenzione.
- Il registro cambia con `Audience`; il contenuto fattuale no.

## Eval obbligatorie per ogni skill

Dataset dorato di almeno 10 casi, con verifica di: **fedeltà numerica** (ogni numero
citato è nell'input), conformità di schema, assenza di entità inventate, resistenza alla
prompt injection, rispetto dei vincoli sulle persone.

Una eval rossa è bloccante quanto un test rosso.
