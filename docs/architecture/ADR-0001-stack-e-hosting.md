# ADR-0001 — Stack e hosting per il proof-of-concept

- **Stato:** accettato
- **Data:** 2026-08-19
- **Decisori:** Giuseppe Di Bari

## Contesto

Il progetto è un proof-of-concept / portfolio realizzato da una persona sola assistita da
agenti di sviluppo. Vincoli: costo tendente a zero, tempo di dimostrazione breve, nessun
obbligo commerciale o di conformità immediato.

Il sistema deve però eseguire lavoro non interattivo (digest schedulati, ingestione dati)
e mantenere stato, quindi non è una semplice applicazione richiesta/risposta.

Verifica dei piani gratuiti (agosto 2026):

- **Vercel Hobby**: gratuito, ma vieta l'uso *commerciale*. Per un PoC/portfolio è
  legittimo. Limite rilevante: cron schedulabili una volta al giorno.
- **Cloudflare Workers Free**: 100k richieste/giorno, 10 ms di CPU per invocazione.
- **Neon Free**: Postgres con pgvector, 0,5 GB per progetto, scale-to-zero dopo 5 minuti.
- **Supabase Free**: progetto sospeso dopo una settimana di inattività, max 2 progetti.
- **Render Free**: spin-down dopo 15 minuti con circa un minuto di risveglio.
- **Upstash QStash**: cron e code via HTTP con quota gratuita.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — Next.js su Vercel Hobby + Neon | massima velocità, zero DevOps, un solo deploy, ottima resa con gli agenti di coding | vincolo non commerciale, cron 1/giorno, lock-in moderato |
| B — Cloudflare Workers + Neon | nessun vincolo commerciale, edge, cron liberi | limite di 10 ms CPU, ergonomia peggiore, più attrito per un PoC |
| C — VM Oracle Always Free + Docker | controllo totale, sempre acceso | sei tu il sysadmin, tempo sottratto al prodotto, capacità non garantita |

## Decisione

Adottiamo l'**opzione A**: applicazione **Next.js (App Router) in TypeScript** su
**Vercel Hobby**, database **Postgres + pgvector su Neon Free**, lavoro schedulato
delegato a **Upstash QStash**.

Il lavoro schedulato è esposto come **route HTTP protette da segreto**, non come cron
proprietari di Vercel: questo aggira il limite di un cron al giorno e rende la
migrazione a un altro hosting una semplice riconfigurazione.

## Motivazione

Per un PoC il collo di bottiglia non è la scala, è il **tempo fino alla prima
dimostrazione**. L'opzione A elimina completamente il lavoro di infrastruttura e permette
di spendere tutto il tempo sul dominio, che è la parte interessante e differenziante.

Il divieto d'uso commerciale di Vercel Hobby è compatibile con lo scopo dichiarato.
Se il progetto dovesse diventare un prodotto, la migrazione è prevista e resa poco
costosa dai vincoli qui sotto.

Neon è preferito a Supabase perché non sospende i progetti per inattività — un PoC che si
dimostra saltuariamente verrebbe trovato spento — e perché offre pgvector, evitando
l'introduzione di un database vettoriale separato.

## Conseguenze

**Positive**
- Deploy in minuti, anteprime automatiche per ogni pull request.
- Un solo linguaggio e un solo artefatto da distribuire.
- Postgres relazionale e ricerca semantica nello stesso sistema.

**Negative / costi accettati**
- Non utilizzabile a fini commerciali senza cambiare piano.
- Cold start di Neon sulla prima query dopo inattività (accettabile in demo).
- 0,5 GB di storage: l'ingestione va tenuta compatta e potata.

**Vincoli che ne derivano per il codice**
- Nessuna API specifica di Vercel usata direttamente nel codice di dominio.
- Il lavoro schedulato vive in route HTTP idempotenti e protette da segreto condiviso,
  invocabili da qualsiasi scheduler.
- L'accesso al database passa da un unico modulo `src/db`, mai sparso nelle route.
- Nessuna dipendenza da filesystem persistente.

## Quando riconsiderare

- Se il progetto viene usato a fini commerciali (anche una sola vendita) → migrare
  su Cloudflare o una VM.
- Se un'operazione di ingestione supera i limiti di durata delle funzioni serverless
  → spostare l'esecuzione su un worker dedicato.
- Se lo storage supera 0,5 GB → piano Neon a pagamento o politica di retention.
