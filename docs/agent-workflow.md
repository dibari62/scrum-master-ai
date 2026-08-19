# Flusso di lavoro con gli agenti

Come si sviluppa questo progetto con una squadra di agenti specializzati.

---

## 1. Perché così

Gli agenti di sviluppo falliscono quasi sempre per due ragioni, e nessuna delle due è la
mancanza di intelligenza del modello:

1. **Mancanza di contesto** — non sanno cosa esiste già, quali vincoli valgono, perché
   una scelta è stata fatta.
2. **Mancanza di verifica** — nessuno stabilisce in modo oggettivo se il lavoro è finito,
   quindi "sembra fatto" diventa "è fatto".

Questo repository risponde a entrambe:

| Problema | Risposta |
|---|---|
| Contesto | `AGENTS.md`, glossario, ADR, spec, istruzioni per percorso |
| Verifica | `npm run verify` + CI + eval sugli output LLM |

---

## 2. La squadra

Undici ruoli in `.github/agents/`. **Non li userai tutti insieme**: in una giornata
tipica ne servono due o tre.

| Agente | Scrive in | Quando usarlo |
|---|---|---|
| `product-analyst` | `specs/`, `docs/` | l'idea non è ancora una specifica |
| `architect` | `docs/architecture/`, `src/domain/` | serve una decisione strutturale o un contratto |
| `data-schema` | `src/domain/`, `src/db/` | modello dati, migrazioni |
| `metrics-engineer` | `src/metrics/` | una nuova metrica o un calcolo di flusso |
| `connector` | `src/connectors/` | integrare una fonte dati |
| `backend` | `src/app/api/`, `src/lib/` | logica applicativa, job |
| `frontend` | `src/app/` | interfaccia |
| `agent-engineer` | `src/agents/`, `evals/` | skill che usano LLM |
| `qa-adversarial` | `tests/`, `evals/` | cercare dove si rompe |
| `security-privacy` | *(sola lettura)* | prima di ogni traguardo |
| `reviewer` | *(sola lettura)* | prima di chiudere una PR |
| `devops` | `.github/`, toolchain | pipeline, deploy |

I ruoli in sola lettura sono deliberatamente tali: un revisore che può correggere smette
di revisionare e comincia a riscrivere, perdendo il distacco che lo rende utile.

---

## 3. Il ciclo di lavoro

```
        idea
          │
          ▼
   product-analyst  ──►  specs/<feature>/spec.md
          │                 (questioni aperte → decide l'umano)
          ▼
      architect     ──►  contratti Zod in src/domain + eventuale ADR
          │
          ▼
   implementazione  ──►  data-schema / metrics-engineer / connector /
   (in parallelo)         backend / frontend / agent-engineer
          │
          ▼
   qa-adversarial   ──►  test che cercano di rompere
          │
          ▼
      reviewer      ──►  rilievi bloccanti / importanti / minori
          │
          ▼
    npm run verify + CI verde  ──►  merge
```

I pulsanti di **handoff** in fondo alla risposta di un agente attivano il passaggio
successivo mantenendo il contesto.

---

## 4. Regole di ingaggio

### 4.1 Spec-first
Nessuna feature non banale parte senza `specs/<feature>/spec.md`.
Se manca, il primo agente da chiamare è il Product Analyst.

### 4.2 Contract-first
Prima gli schemi Zod e le firme pubbliche, poi l'implementazione.
È ciò che permette a due agenti di lavorare in parallelo senza distruggersi il lavoro a
vicenda: entrambi programmano contro lo stesso contratto stabile.

### 4.3 Un agente, un ambito
Ogni agente ha una zona di scrittura dichiarata. Se un agente deve toccare il territorio
di un altro, il lavoro va spezzato. La sovrapposizione è la causa numero uno dei conflitti
e delle regressioni silenziose.

### 4.4 PR piccole
Una feature = una PR = idealmente meno di 400 righe di diff. Oltre le 600 si spezza.
Una PR che nessun umano riesce a leggere non è stata revisionata, è stata approvata.

### 4.5 La CI è il giudice
Un agente non dichiara di aver finito: lo stabilisce `npm run verify`.
Vietate le formule "dovrebbe funzionare", "presumibilmente", "una volta installato".

### 4.6 Mai indebolire un test
Un test che fallisce si corregge o si segnala. Non si cancella, non si mette in skip, non
si allenta l'asserzione. Vale in modo assoluto per la suite avversariale sulla prompt
injection e per le eval di fedeltà numerica.

### 4.7 L'umano è il Product Owner
Decide **cosa** e **perché**. Gli agenti decidono il **come**.
Davanti a un'ambiguità di prodotto un agente **non indovina**: la registra fra le
questioni aperte e chiede.

---

## 5. Errori tipici da evitare

| Errore | Conseguenza | Rimedio |
|---|---|---|
| Chiedere una feature senza spec | l'agente inventa i requisiti mancanti | passa prima dal Product Analyst |
| Far scrivere a un agente fuori dal suo ambito | conflitti, regressioni | spezza il lavoro |
| Accettare "dovrebbe funzionare" | difetti che emergono in demo | esigi la verifica eseguita |
| Far calcolare le metriche all'LLM | numeri sbagliati, fiducia persa | ADR-0002 |
| Aggiungere una dipendenza al volo | stack che si sfilaccia | serve un ADR |
| Saltare le eval sulle skill | regressioni invisibili nei prompt | dataset dorato obbligatorio |
| Usare sinonimi fuori dal glossario | modello dati incoerente | il glossario è vincolante |

---

## 6. Uso pratico in VS Code

- Gli agenti compaiono nel selettore della chat: sono i file `.agent.md` in
  `.github/agents/`.
- `AGENTS.md` e `.github/copilot-instructions.md` si applicano automaticamente a ogni
  richiesta.
- I file `.github/instructions/*.instructions.md` si attivano da soli quando si lavora su
  percorsi corrispondenti al loro `applyTo`.
- Per una richiesta complessa, comincia dall'agente più a monte del ciclo e usa gli
  handoff invece di rispiegare il contesto ogni volta.
