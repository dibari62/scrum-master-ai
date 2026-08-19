# Roadmap

Ordine di costruzione del proof-of-concept. Ogni traguardo produce qualcosa di
**dimostrabile**: se un traguardo non aggiunge nulla di mostrabile, è nel posto sbagliato.

Principio guida: **i primi due traguardi non contengono una sola chiamata a un LLM.**
Il livello dati e le metriche sono ciò su cui poggia tutto il resto; costruire prima le
funzionalità appariscenti significa costruirle due volte.

---

## T0 — Fondamenta

**Obiettivo:** scheletro funzionante e distribuito, anche se vuoto.

- Progetto Next.js + TypeScript strict + Tailwind + shadcn/ui
- `npm run verify` (typecheck + lint + test) funzionante
- CI verde
- Auth.js: registrazione e accesso
- Modello `Organization` / `User` / `Membership` con isolamento verificato da test
- Deploy su Vercel + database Neon collegato

**Dimostrabile:** ci si registra come azienda ed è online.

---

## T1 — Modello canonico e ingestione

**Obiettivo:** i dati esistono, in forma canonica.

- Entità di `src/domain` con schemi Zod (ADR-0003)
- Schema Drizzle e migrazioni
- `Project`: creazione e gestione degli N progetti aziendali
- Connettore `seed`: **quattro sprint di storia sintetica realistica**, deterministica,
  con anomalie volute (collo di bottiglia in revisione, aumento di perimetro a metà
  sprint, item bloccato a lungo, lavoro trascinato in peggioramento)
- Suite di conformità dei connettori

**Dimostrabile:** si crea un progetto e lo si popola con una storia credibile.

---

## T2 — Motore metriche e dashboard ⭐

**Obiettivo:** il traguardo più importante del progetto.

- `src/metrics` puro e testato: velocity, burndown, cycle time, lead time, WIP,
  variazione di perimetro, lavoro trascinato, invecchiamento, tasso di riapertura,
  attesa in revisione
- Test su tutti i casi limite obbligatori
- Dashboard di progetto con i grafici principali
- Stati vuoto / caricamento / errore

**Dimostrabile:** una dashboard di metriche di flusso corretta e verificabile —
**senza una singola chiamata a un LLM**. Da sola è già un progetto presentabile.

---

## T3 — Creazione dello Scrum Master AI

**Obiettivo:** l'oggetto centrale dell'idea.

- Entità `ScrumAgent`: persona, tono, lingua, skill abilitate, policy, livello di autonomia
- Wizard di creazione per progetto
- Contesto di progetto: durata sprint, giorni delle cerimonie, Definition of Done,
  working agreement, stakeholder
- Gateway LLM `src/lib/llm` con provider fittizio per i test
- Registro delle esecuzioni (`SkillRun`) con costo e esito

**Dimostrabile:** si crea uno Scrum Master AI per un progetto, in due minuti.

---

## T4 — Prime skill: Sprint Report e Digest giornaliero

**Obiettivo:** il primo output generato, fondato su numeri veri.

- Skill `sprint-report`, declinata per `Audience` (team / manager / stakeholder)
- Skill `daily-digest`: cosa è cambiato, cosa non si è mosso, chi è bloccato
- Dataset dorato ed eval di fedeltà numerica
- Suite avversariale sulla prompt injection
- Riscontro dell'utente sugli output (utile / non utile / correggi)

**Dimostrabile:** un report di sprint presentabile a uno stakeholder così com'è.

---

## T5 — Salute dello sprint e colli di bottiglia

**Obiettivo:** la parte proattiva, quella che colpisce in una demo.

- Skill `sprint-health`: semaforo con motivo ed evidenza
- Skill `bottleneck-detection`: individuazione della fase che rallenta il flusso
- `Insight` e `Alert` con evidenza e livello di confidenza
- Esecuzione schedulata via route HTTP protetta (invocata da Upstash QStash)

**Dimostrabile:** il sistema segnala da solo un problema **prima** che venga chiesto,
e sa spiegare su quale evidenza si basa.

---

## T6 — Q&A sul progetto

**Obiettivo:** interazione libera, unico punto legittimamente aperto del sistema.

- Indicizzazione con pgvector di `KnowledgeItem`, `Decision`, `Comment`
- Skill `project-qa` con citazione obbligatoria delle fonti
- Memoria di progetto alimentata dalle correzioni dell'umano

**Dimostrabile:** "perché siamo in ritardo?" riceve una risposta contestuale e citata.

---

## T7 — Connettore reale (opzionale)

**Obiettivo:** dimostrare che non è un giocattolo alimentato a dati finti.

- Connettore `github` (Issues / Projects): OAuth, ingestione incrementale, backfill
- Sostituisce il `seed` **senza toccare metriche, skill o interfaccia** — è la prova che
  il modello canonico di ADR-0003 è corretto

**Dimostrabile:** si collega un repository reale e tutto continua a funzionare.

---

## Fuori perimetro per ora

Registrato per non riaprire la discussione a ogni traguardo:

- Jira, Azure DevOps, Slack, Microsoft Teams (costo di approvazione elevato)
- Trascrizione di riunioni e minute (richiede consensi e cautele legali)
- Analisi delle conversazioni dei dipendenti → vedi `AGENTS.md` §8.2: se e quando verrà
  affrontata, solo come **indicatori di processo aggregati**, mai come inferenza emotiva
- Livelli di autonomia `act_with_approval` e `autonomous` (il PoC si ferma a `report`)
- Fatturazione, piani, onboarding commerciale
- Applicazione mobile
