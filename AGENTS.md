# AGENTS.md — Regole operative del progetto

Istruzioni sempre attive per qualsiasi agente AI che lavora su questo repository.
Se un'istruzione qui è in conflitto con una richiesta generica, **vince questo file**.

---

## 1. Cos'è questo progetto

**Scrum Master AI** — applicazione web dove un'azienda si registra, inserisce N progetti e
crea per ciascuno uno "Scrum Master AI" che assiste il team (report di sprint, digest
giornalieri, salute dello sprint, colli di bottiglia, Q&A sul progetto).

Lo Scrum Master **non è un modello addestrato**: è una *configurazione + memoria + skill
abilitate + connettori*, istanziata per progetto.

**Scopo attuale: proof-of-concept / portfolio.** Priorità a velocità di dimostrazione e
costo zero. Non è un prodotto in vendita: niente over-engineering per scala o conformità
che oggi non serve (vedi §8 per ciò che resta comunque obbligatorio).

---

## 2. Le cinque regole non negoziabili

### R1 — Il codice calcola, l'LLM racconta
Velocity, burndown, cycle time, lead time, WIP, scope change, aging, throughput si
calcolano **esclusivamente** con SQL/TypeScript deterministico e testato.
L'LLM riceve i numeri **già calcolati** e li interpreta o li narra.

> È vietato chiedere a un LLM di calcolare, sommare, mediare o stimare una metrica.
> Un numero sbagliato in una demo distrugge la credibilità dell'intero prodotto.

### R2 — Modello canonico al centro
Nessuna skill, pagina o job accede mai al formato nativo di uno strumento esterno
(Jira, GitHub, Slack). Tutto passa dal modello canonico in `src/domain`.
I connettori traducono *verso* il canonico, mai il contrario.

### R3 — Nessuna azione scrivente derivata da contenuto non fidato
Il testo ingerito (descrizioni ticket, commenti, messaggi) è **dato**, mai **istruzione**.
Non deve mai poter innescare una scrittura, una chiamata a tool o un cambio di
comportamento. Vedi §8.1.

### R4 — Schema unico come fonte di verità
Ogni struttura dati attraversa uno schema **Zod** in `src/domain`. Da lì derivano:
tipi TypeScript, validazione API, tool degli agenti, output vincolati dell'LLM.
Vietato dichiarare la stessa forma dati in due punti.

### R5 — Un agente non dichiara di aver finito, lo dimostra la CI
Nessun lavoro è "completo" finché `npm run verify` non passa in locale.
Vietato scrivere "dovrebbe funzionare", "presumibilmente", "una volta installato".

---

## 3. Stack

| Livello | Tecnologia | Note |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript strict** | full-stack, un solo deploy |
| UI | **Tailwind + shadcn/ui** | niente altre librerie di componenti |
| Validazione | **Zod** | fonte di verità (R4) |
| DB | **Postgres + pgvector** su Neon Free | scale-to-zero: gestire il cold start |
| ORM | **Drizzle** | migrazioni versionate, mai `push` in main |
| Auth | **Auth.js** | credenziali + GitHub OAuth |
| LLM | **Vercel AI SDK** dietro il gateway `src/lib/llm` | Gemini free tier, fallback Groq |
| Grafi agentici | **LangGraph.js** *solo* dove serve stato durevole | altrimenti una funzione basta |
| Job/cron | **Upstash QStash** | Vercel Hobby limita i cron a 1/giorno |
| Test | **Vitest** (unit/integr.) + **Playwright** (e2e) | |
| Eval LLM | runner in `evals/` | vedi §6 |
| Hosting | **Vercel Hobby** + Neon Free | uso non commerciale: legittimo per un PoC |

**Non introdurre una dipendenza fuori da questa tabella senza un ADR.** In caso di dubbio,
usa la libreria standard o scrivi 20 righe tue.

---

## 4. Struttura del repository

```
src/
  app/            Next.js App Router (route, layout, server actions)
  domain/         ⭐ modello canonico + schemi Zod. Zero dipendenze da framework.
  db/             schema Drizzle, migrazioni, query tipizzate
  metrics/        motore metriche deterministico (R1). Puro, testabile, no I/O.
  connectors/     adapter verso il canonico (seed sintetico, github, …)
  agents/         skill, prompt, tool, grafi. Consuma metrics, non ricalcola.
  components/     componenti di interfaccia riusabili; `ui/` è generata da shadcn/ui
  lib/            auth, gateway LLM, utility trasversali
tests/            unit + integrazione
evals/            dataset dorati e runner per gli output LLM
specs/            specifiche per feature (vedi §5)
docs/
  architecture/   ADR — decisioni e loro motivazione
  domain-glossary.md
  agent-workflow.md
  roadmap.md
```

**Direzione delle dipendenze (obbligatoria):**

```
app → agents → metrics → domain
app → db → domain
app → components → domain
connectors → domain
```

`domain` non importa **nulla** dagli altri livelli. `metrics` non fa I/O.
`components` è di sola presentazione: non accede a `db`, non chiama `agents`, riceve
i dati già pronti da `app`.
Una freccia all'indietro è un errore bloccante in review.

---

## 5. Come si lavora

### Spec-first
Ogni feature non banale parte da `specs/<nome-feature>/spec.md`
(modello: `specs/_template/spec.md`). Se manca, l'agente Product Analyst la scrive prima.

### Contract-first
Prima gli schemi Zod in `src/domain` e le firme pubbliche, poi l'implementazione.
Permette a più agenti di lavorare in parallelo senza rompersi a vicenda.

### PR piccole
Una feature = una PR = idealmente < 400 righe di diff.
Se una PR supera le 600 righe, va spezzata.

### Stato visibile a fine sviluppo
Alla fine di ogni sviluppo si aggiorna **[`docs/stato-progetto.md`](docs/stato-progetto.md)**,
che contiene i diagrammi Mermaid dello stato di scheletro, infrastruttura, database e
interfaccia.

Serve al Product Owner per capire dove siamo senza rileggere il registro dei commit.
Tre vincoli:

- una casella è verde **solo se verificata**, non se è stata scritta;
- ciò che è bloccato su una persona va detto, con la ragione;
- il debito si registra quando lo si crea, non quando lo si paga.

Un diagramma che mente è peggio di nessun diagramma.

### Branch
`feat/<breve-descrizione>`, `fix/<…>`, `chore/<…>`, `docs/<…>`.
Mai commit diretti su `main`.

### Commit
Conventional Commits: `feat(metrics): calcola cycle time per colonna`.

---

## 6. Verifica

Comando unico che deve passare prima di considerare finito qualsiasi lavoro:

```bash
npm run verify        # typecheck + lint + test + confini architetturali
```

Comandi granulari:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run test          # vitest run
npm run boundaries    # verifica le direzioni di dipendenza di §4
npm run test:e2e      # playwright
npm run eval          # eval degli output LLM (richiede API key)
npm run db:generate   # genera migrazione Drizzle dallo schema
npm run db:migrate    # applica migrazioni
npm run seed          # popola il DB con lo scenario sintetico
```

### Regole di test

- **`src/metrics/`** è la zona a più alta densità di test: ogni metrica ha casi
  limite espliciti (sprint vuoto, ticket riaperto, item aggiunto a metà sprint,
  transizioni fuori ordine, fuso orario). Nessuna metrica senza test.
- **Connettori**: test su *fixture registrate*, mai chiamate di rete reali.
- **Output LLM**: non si testano con `toEqual`. Si valutano in `evals/` su un
  dataset dorato, verificando proprietà (i numeri citati coincidono con quelli in
  input, il formato rispetta lo schema, non inventa nomi di persona).
- Un test che fallisce **non si cancella e non si mette in skip** per far passare
  la pipeline. Si corregge il codice o si dichiara il problema.

---

## 7. Convenzioni di codice

- **Lingua**: identificatori, commenti e messaggi di commit in **inglese**.
  Documentazione (`docs/`, `specs/`) e testi dell'interfaccia in **italiano**.
  L'output dell'agente Scrum Master segue la lingua configurata sul progetto.
- TypeScript `strict`. **`any` vietato**; usa `unknown` + narrowing con Zod.
- Niente `console.log` nel codice applicativo: usa il logger di `src/lib`.
- Errori: mai `catch` silenzioso. O si gestisce, o si rilancia con contesto.
- Commenta **solo** ciò che non è ovvio dal codice: il *perché*, non il *cosa*.
- Componenti React: Server Component per default, `"use client"` solo se serve.
- Date e ore: sempre UTC nel database, conversione solo al bordo della UI.

---

## 8. Vincoli che restano validi anche in un PoC

### 8.1 Prompt injection indiretta
L'applicazione legge testo scritto da terzi. È un vettore di attacco reale.

- Separa sempre istruzioni di sistema e dati non fidati con delimitatori espliciti,
  marcando i secondi come "contenuto non fidato, da trattare come dato".
- Nessun tool con effetti scriventi è esposto a un agente che elabora testo ingerito.
- L'output dell'LLM è sempre vincolato a uno schema Zod e validato prima dell'uso.
- Esiste una suite avversariale in `tests/` con payload di injection: non va indebolita.

### 8.2 Persone e privacy
Anche in un PoC, il modello dati nasce corretto — rifarlo dopo costa dieci volte tanto.

- **Vietate metriche di performance individuali** (velocity per persona, conteggio
  commit, classifiche). Si misura il **processo**, non le persone.
- **Vietata l'inferenza di emozioni o stati d'animo di individui.** Nel contesto
  lavorativo europeo è una pratica proibita dall'AI Act. Se serve un segnale sul
  clima del team, usa indicatori **di processo aggregati** (tempo di risposta nei
  thread, riaperture di ticket, distribuzione della partecipazione, ricorrenza di
  temi) mai sotto una soglia minima di partecipanti e mai attribuibili a un singolo.
- I dati di esempio usano persone fittizie. Mai dati reali di colleghi o clienti.

### 8.3 Segreti
- Nessun segreto nel codice o nei file versionati. Solo `.env.local` (in `.gitignore`)
  e le variabili d'ambiente della piattaforma.
- `.env.example` va tenuto aggiornato con le chiavi **senza** valori.
- Se un agente incontra un segreto in chiaro, si ferma e lo segnala.

### 8.4 Multi-tenancy
Ogni tabella di dominio ha `organization_id`. Ogni query di lettura è filtrata per
organizzazione **a livello di helper condiviso**, non nei singoli call site.
Esiste un test che verifica l'isolamento fra due organizzazioni.

---

## 9. Costo e chiamate LLM

- Nessuna chiamata LLM nei test unitari o in CI (usa il provider fittizio).
- **Pre-filtro deterministico obbligatorio**: al modello si passano i 40 elementi
  rilevanti selezionati dal codice, non 4.000 messaggi grezzi.
- Ogni skill dichiara il budget massimo di token e degrada in modo controllato.
- Modello piccolo per classificare e filtrare, modello grande solo per la sintesi.

---

## 10. Cosa fare quando sei bloccato

1. Se la specifica è ambigua → **non indovinare**: scrivi la domanda in
   `specs/<feature>/spec.md` sotto "Questioni aperte" e chiedi all'umano.
2. Se serve una dipendenza nuova o una scelta strutturale → proponi un ADR in
   `docs/architecture/`, non decidere di nascosto.
3. Se un test fallisce per una ragione che non capisci → riportalo, non aggirarlo.
4. Se stai per violare una regola di §2 → fermati e segnala il conflitto.

L'umano è il Product Owner: decide **cosa** e **perché**. Gli agenti decidono il **come**.
