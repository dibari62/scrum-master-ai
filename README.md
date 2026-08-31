# Scrum Master AI

Applicazione web dove un'azienda si registra, inserisce i propri progetti e crea per
ciascuno uno **Scrum Master AI** che assiste il team: report di sprint, digest
giornalieri, monitoraggio della salute dello sprint, individuazione dei colli di
bottiglia e domande e risposte sul progetto.

Lo Scrum Master AI non è un modello addestrato: è una *configurazione + memoria + skill
abilitate + connettori*, istanziata per progetto.

> **Stato:** proof-of-concept / portfolio. Non è un prodotto commerciale.

---

## Idea in breve

```
Organization (azienda)
 └── Project (N progetti)
      ├── Integration    →  fonti dati (seed sintetico, GitHub, …)
      └── ScrumAgent     →  persona, skill abilitate, policy, memoria
```

Sotto le skill c'è un **livello dati condiviso**: i connettori traducono ogni fonte in un
**modello canonico Scrum**, su cui un motore deterministico calcola le metriche di flusso.
L'LLM interviene solo per interpretare e narrare numeri già calcolati.

---

## Principio centrale

> **Il codice calcola, l'LLM racconta.**

Velocity, burndown, cycle time, WIP e metriche DORA sono prodotti da funzioni pure e
testate. Al modello linguistico non viene mai chiesto di calcolare, sommare o stimare.
Un numero sbagliato in un report distrugge la fiducia nell'intero sistema.

Vedi [ADR-0002](docs/architecture/ADR-0002-metriche-deterministiche.md).

---

## Stack

Next.js (App Router) · TypeScript strict · Tailwind + shadcn/ui · Zod ·
Postgres + pgvector (Neon) · Drizzle · Auth.js · Vercel AI SDK · Vitest · Playwright

Hosting: Vercel Hobby + Neon Free + Upstash QStash.
Motivazioni e alternative scartate in [ADR-0001](docs/architecture/ADR-0001-stack-e-hosting.md).

---

## Struttura

```
src/
  app/            route Next.js
  components/     componenti UI condivisi (shadcn/ui in components/ui)
  domain/         ⭐ modello canonico + schemi Zod (non importa nulla)
  db/             schema Drizzle, migrazioni, query
  metrics/        motore metriche deterministico (puro, no I/O)
  connectors/     adapter verso il modello canonico
  agents/         skill dello Scrum Master AI
  lib/            auth, gateway LLM, utility
tests/            unit e integrazione
evals/            dataset dorati per gli output LLM
specs/            specifiche per feature
docs/             architettura, glossario, roadmap
scripts/          controllo dei confini architetturali
```

Direzione delle dipendenze, verificata automaticamente in CI:

```
app → agents → metrics → domain
app → db → domain
connectors → domain
```

---

## Sviluppo assistito da agenti

Il progetto è sviluppato con una squadra di agenti AI specializzati.

| Documento | Contenuto |
|---|---|
| [`AGENTS.md`](AGENTS.md) | regole operative sempre attive |
| [`docs/ripartire-da-zero.md`](docs/ripartire-da-zero.md) | **come riprendere il progetto da una macchina vuota** |
| [`docs/agent-workflow.md`](docs/agent-workflow.md) | come si lavora con la squadra |
| [`docs/domain-glossary.md`](docs/domain-glossary.md) | vocabolario vincolante |
| [`docs/architecture/`](docs/architecture/) | decisioni e loro motivazione |
| [`docs/roadmap.md`](docs/roadmap.md) | ordine di costruzione |
| [`docs/guardare-i-dati.md`](docs/guardare-i-dati.md) | come ispezionare i dati di prova |
| [`.github/agents/`](.github/agents/) | i dodici ruoli |

I ruoli compaiono nel selettore della chat di VS Code.
Il ciclo tipico: `product-analyst` → `architect` → implementazione →
`qa-adversarial` → `reviewer`.

---

## Comandi

> **`npm run <nome>` è una scorciatoia**, non un comando di sistema.
> `package.json` contiene un elenco di comandi con un nome breve, e `npm run`
> esegue quello che gli corrisponde. Si scrive nel terminale di VS Code
> (*Terminale → Nuovo terminale*), e `npm run` **senza argomenti** stampa tutti
> quelli disponibili.
>
> Il concetto è spiegato per esteso, con il ponte verso l'AS/400, in
> [`docs/dall-as400-al-web.md`](docs/dall-as400-al-web.md) §4.bis.

```bash
npm run verify        # typecheck + lint + test + confini — il contratto di "fatto"
npm run dev           # sviluppo locale
npm run build         # build di produzione
npm run test          # test unitari e di integrazione
npm run test:e2e      # test end-to-end su Chrome        (richiede RUN_E2E=1)
npm run eval          # valutazione degli output LLM, richiede una chiave (T4)
npm run chiave        # genera SECRETS_KEY e la mette negli appunti
npm run libro         # quanto del libro è implementato
npm run db:generate   # genera una migrazione dallo schema
npm run db:migrate    # applica le migrazioni
npm run db:inspect    # cosa c'è davvero nel database — sola lettura
npm run seed          # prova a vuoto: mostra cosa farebbe
npm run seed -- --conferma   # scrive davvero
npm run boundaries    # verifica i confini architetturali
```

> **Il `--` isolato** dice a `npm`: «quello che segue non è per te, passalo al
> comando». Senza, `npm` proverebbe a interpretare `--conferma` come una propria
> opzione.

Strumenti per lavorare in questo ambiente, documentati in
[`docs/ripartire-da-zero.md`](docs/ripartire-da-zero.md):

```bash
npm run dev:user -- add        # account temporaneo per ispezionare pagine protette
npm run dev:user -- remove     # e per rimuoverlo
npm run diagnose:tls -- <host> # perché una connessione TLS fallisce
npm run gh -- pr-status <owner> <repo> <n>   # pull request dalla riga di comando
```

Gli script marcati con un traguardo esistono già ma **escono con errore** finché la parte
corrispondente non è costruita: non devono mai far credere che un passo sia stato eseguito.

> Su questa macchina l'esecuzione di script PowerShell è disabilitata e i collegamenti
> `.cmd` in `node_modules\.bin` sono bloccati da criteri di gruppo. Per questo gli script
> invocano direttamente il punto di ingresso Node (`node node_modules/typescript/bin/tsc`,
> …): la stessa riga funziona in locale e in CI. Lancia `npm` da `cmd.exe`, oppure con
> `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" <comando>`.

---

## Configurazione

Copia `.env.example` in `.env.local`, valorizza le variabili e genera i segreti
con `node scripts/generate-secrets.mjs`. Poi `node scripts/check-env.mjs` dice
cosa manca.

> **Il modello linguistico non si configura qui.** Lo sceglie chi usa il
> portale, progetto per progetto, dalla scheda «Modello» delle impostazioni: la
> chiave è sua, e vive cifrata nel database
> ([ADR-0010](docs/architecture/ADR-0010-chiavi-del-cliente.md)). Le variabili
> `LLM_*` in `.env.example` riguardano **solo `npm run eval`**, che gira da riga
> di comando e non ha un progetto da cui prendere una chiave.
>
> Serve però `SECRETS_KEY`: è ciò con cui quelle chiavi vengono cifrate. Senza,
> il portale **rifiuta** di conservarle — e lo dichiara, invece di tenerle in
> chiaro.

---

## Vincoli di prodotto

Anche trattandosi di un proof-of-concept, due regole non vengono derogate:

- **Nessuna metrica di performance individuale.** Si misura il processo, non le persone.
- **Nessuna inferenza di emozioni o stati d'animo individuali.** Nel contesto lavorativo
  europeo è una pratica proibita dall'AI Act. Il clima del team, se misurato, si esprime
  con indicatori **di processo aggregati**.

Dettagli in [`AGENTS.md`](AGENTS.md) §8.
