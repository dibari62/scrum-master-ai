# Stato del progetto

> Fotografia aggiornata a ogni fine sviluppo. Se una casella è verde, esiste **ed è
> stata verificata**; se è gialla è in corso; se è grigia non è ancora iniziata.
>
> Ultimo aggiornamento: **22/08/2026** — T0, T1 e T2 in `main` (PR #2 → #15),
> applicazione online, T3 iniziato dalla specifica.

---

## 1. I quattro livelli, a colpo d'occhio

```mermaid
graph TB
    subgraph SCH["🦴 Scheletro"]
        S1["Next.js 16 + TypeScript strict"]
        S2["Tailwind + shadcn/ui"]
        S3["Vitest · 386 test<br/>Playwright · 15 test e2e"]
        S4["Confini architetturali<br/>verificati da script"]
    end

    subgraph INF["⚙️ Infrastruttura"]
        I1["CI GitHub Actions"]
        I2["Neon · Postgres"]
        I3["Vercel · deploy"]
        I4["Upstash QStash · job"]
    end

    subgraph DB["🗄️ Database"]
        D1["Modello canonico Zod<br/>4 entità di tenancy"]
        D2["Schema Drizzle<br/>16 tabelle create"]
        D3["Isolamento fra aziende<br/>verificato su Postgres vero"]
        D4["Entità Scrum<br/>Sprint · WorkItem · Transizioni"]
    end

    subgraph UI["🖥️ Interfaccia"]
        U1["Home"]
        U2["Registrazione"]
        U3["Accesso"]
        U4["Area azienda"]
        U5["Dashboard metriche"]
        U7["Elementi e storia<br/>degli stati"]
        U6["Scrum Master AI"]
    end

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef corso fill:#eab308,stroke:#ca8a04,color:#000
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class S1,S2,S3,S4 fatto
    class I1,I2,I3 fatto
    class I4 todo
    class D1,D2,D3,D4 fatto
    class U1,U2,U3,U4,U5,U7 fatto
    class U6 todo
```

**Come leggerlo:** scheletro, database e metriche sono solidi e verificati in un
browser, non solo dai test. Ogni numero della dashboard è ora **apribile**: si
arriva agli elementi che lo compongono e alla storia degli stati da cui è
calcolato. Resta da costruire lo Scrum Master AI vero e proprio — la parte che dà
il nome al prodotto. I job schedulati non servono ancora.

---

## 2. Roadmap dei traguardi

```mermaid
graph LR
    T0["<b>T0</b><br/>Fondamenta<br/>———<br/>auth · tenancy<br/>✅ online"]
    T1["<b>T1</b><br/>Modello canonico<br/>———<br/>entità Scrum<br/>connettore seed"]
    T2["<b>T2</b><br/>⭐ Metriche<br/>———<br/>motore + dashboard<br/><i>zero LLM</i>"]
    T3["<b>T3</b><br/>Scrum Master AI<br/>———<br/>creazione agente"]
    T4["<b>T4</b><br/>Prime skill<br/>———<br/>report · digest"]
    T5["<b>T5</b><br/>Proattività<br/>———<br/>salute · colli"]
    T6["<b>T6</b><br/>Q&A<br/>———<br/>pgvector"]

    T0 --> T1 --> T2 --> T3 --> T4 --> T5 --> T6

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef prossimo fill:#eab308,stroke:#ca8a04,color:#000
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class T0,T1,T2 fatto
    class T3 prossimo
    class T4,T5,T6 todo
```

**T2 è il traguardo che dà credibilità al resto**: tutti i numeri che
l'applicazione mostra sono calcolati da codice deterministico e testato. Nessun
modello linguistico li ha toccati. T3 è il primo in cui un LLM entra davvero, e
la regola R1 — il codice calcola, l'LLM racconta — smette di essere teorica.

---

## 3. Cosa è vivo, e dove

| Ambiente | Stato | Dettaglio |
|---|---|---|
| **Locale** | ✅ funzionante | `npm run dev`, giro completo provato in Chrome |
| **Neon (Postgres)** | ✅ attivo | 16 tabelle, migrazioni applicate, popolato con 51 elementi e 222 transizioni sintetiche |
| **CI (GitHub Actions)** | ✅ configurata | typecheck, lint, test, build, confini |
| **Vercel** | ✅ **online** | protezione disattivata, verificato `200`; accesso e isolamento funzionanti sul dominio pubblico |
| **Upstash QStash** | ⬜ non serve ancora | chiavi presenti, primo uso previsto a T5 |

### Come guardarci dentro

Istruzioni per il Product Owner in
[`guardare-i-dati.md`](guardare-i-dati.md): dal sito pubblicato, in locale, o
interrogando direttamente il database con SQL.

**L'applicazione online e il computer di sviluppo usano lo stesso database.** Non
ci sono due copie dei dati. È comodo per una dimostrazione e va cambiato prima di
avere dati veri: oggi un `npm run seed` sbagliato tocca ciò che si vede online.

---

## 4. Dove siamo

```mermaid
graph LR
    A["T0<br/>fondamenta"] --> B["T1<br/>modello canonico"]
    B --> C["T2<br/>metriche + dashboard"]
    C --> C1["T2.1<br/>si entra nei numeri"]
    C1 --> D["T3<br/>Scrum Master AI"]
    D --> D1["spec ✅"]
    D --> D2["contratti Zod"]
    D --> D3["gateway LLM"]
    D --> D4["wizard"]

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef prossimo fill:#eab308,stroke:#ca8a04,color:#000
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class A,B,C,C1,D1 fatto
    class D,D2 prossimo
    class D3,D4 todo
```

**T2.1 non era in roadmap.** È nato da un'osservazione del Product Owner: la
dashboard dichiarava un cycle time mediano su 44 elementi e non c'era modo di
vedere quali. Un numero in cui non si può entrare è un numero che si deve
accettare per fede.

Nessun passaggio è più bloccato su una persona. Restano **tre** cose che
attendono il Product Owner, nessuna delle quali ferma lo sviluppo:

| Questione | Dove | Effetto se non decisa |
|---|---|---|
| **Q2** — un elemento bloccato fa parte del carico? | [glossario](domain-glossary.md) | il WIP continua a escluderlo |
| `LLM_API_KEY` su Vercel va rinominata | [messa-in-linea](messa-in-linea.md) | nessuno finché il provider è `fake`; con un fornitore vero la chiave non verrebbe letta |
| Rotazione della password Neon | §5 qui sotto | nessuno finché i dati sono sintetici |

Le **otto questioni aperte** della specifica di T3 hanno tutte una risposta
provvisoria motivata, quindi non bloccano nulla. Due sono già state decise (Q3 e
Q4) applicando lo stesso criterio: **fra due scelte difendibili si prende quella
reversibile**, e su un'autorizzazione non si sceglie mai la permissiva in
silenzio.

---

## 5. Debito registrato

Cose note e volutamente rimandate, non sviste:

| Voce | Dove è documentata | Quando va affrontata |
|---|---|---|
| Nessuna limitazione di frequenza sull'accesso | `AGENTS.md` §8.1 | ora che il sito è pubblico, prima dei dati veri |
| Revoca di `Membership` non immediata | ADR-0006 | prima di un uso reale |
| Nessuna verifica dell'indirizzo email | ADR-0006 | dopo il PoC |
| Nessun recupero password | — | dopo il PoC |
| Password Neon comparsa in chiaro, mai ruotata | decisione consapevole del PO | prima dei dati veri |
| Sviluppo e produzione condividono il database | §3 qui sopra | prima dei dati veri |
| `LLM_API_KEY` su Vercel non verrà mai letta | [messa-in-linea](messa-in-linea.md) | prima di usare un fornitore vero |
| `reviewWaitTime` misura lo stato, non la pull request | [glossario](domain-glossary.md) | con il connettore GitHub |
| Spec-first mai usato | `AGENTS.md` §5 | ~~da T3 in poi~~ **fatto**: `specs/scrum-agent/spec.md` scritta prima del codice |
| Agenti specializzati mai usati | `docs/agent-workflow.md` | ~~da T3 in poi~~ **in corso**: `product-analyst` e `architect` usati su T3 |
| `npm run test:e2e` è un segnaposto | — | ~~quando le pagine si moltiplicano~~ **fatto**: 15 test Playwright su Chrome |
| Registrazione dal browser non provata end-to-end | — | ~~serve Playwright~~ **fatto** |
| Strumenti di lavoro fuori dal repository | — | ~~sparirebbero con la sessione~~ **fatto**: PR #14 |

---

## 6. Come si aggiorna questo file

Va riscritto **alla fine di ogni sviluppo**, insieme al codice che descrive.
Un diagramma che mente è peggio di nessun diagramma.

Regole:

- una casella è verde **solo** se è stata verificata, non se è stata scritta
- ciò che è bloccato su una persona va detto, con la ragione
- il debito si aggiunge quando lo si crea, non quando lo si paga

**I diagrammi vanno controllati prima di consegnarli.** Un blocco Mermaid con un
errore di sintassi non sparisce: GitHub lo sostituisce con un riquadro rosso, e il
risultato è peggio dell'assenza del diagramma. Il modo più rapido, senza aggiungere
dipendenze al progetto, è incollarlo su [mermaid.live](https://mermaid.live).

I tre diagrammi di questo file sono stati validati con il parser di Mermaid 11.
