# Stato del progetto

> Fotografia aggiornata a ogni fine sviluppo. Se una casella è verde, esiste **ed è
> stata verificata**; se è gialla è in corso; se è grigia non è ancora iniziata.
>
> Ultimo aggiornamento: **20/08/2026** — T0 integrato in `main` (PR #2).

---

## 1. I quattro livelli, a colpo d'occhio

```mermaid
graph TB
    subgraph SCH["🦴 Scheletro"]
        S1["Next.js 16 + TypeScript strict"]
        S2["Tailwind + shadcn/ui"]
        S3["Vitest · 155 test"]
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
        D2["Schema Drizzle<br/>6 tabelle create"]
        D3["Isolamento fra aziende<br/>verificato su Postgres vero"]
        D4["Entità Scrum<br/>Sprint · WorkItem · Transizioni"]
    end

    subgraph UI["🖥️ Interfaccia"]
        U1["Home"]
        U2["Registrazione"]
        U3["Accesso"]
        U4["Area azienda"]
        U5["Dashboard metriche"]
        U6["Scrum Master AI"]
    end

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef corso fill:#eab308,stroke:#ca8a04,color:#000
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class S1,S2,S3,S4 fatto
    class I1,I2 fatto
    class I3,I4 todo
    class D1,D2,D3 fatto
    class D4 todo
    class U1,U2,U3,U4 fatto
    class U5,U6 todo
```

**Come leggerlo:** scheletro e database sono solidi. L'interfaccia esiste per tutto
ciò che serve a entrare nel prodotto. L'infrastruttura ha un buco: **il deploy non
esiste ancora**.

---

## 2. Roadmap dei traguardi

```mermaid
graph LR
    T0["<b>T0</b><br/>Fondamenta<br/>———<br/>auth · tenancy<br/>✅ codice<br/>❌ online"]
    T1["<b>T1</b><br/>Modello canonico<br/>———<br/>entità Scrum<br/>connettore seed"]
    T2["<b>T2</b><br/>⭐ Metriche<br/>———<br/>motore + dashboard<br/><i>zero LLM</i>"]
    T3["<b>T3</b><br/>Scrum Master AI<br/>———<br/>creazione agente"]
    T4["<b>T4</b><br/>Prime skill<br/>———<br/>report · digest"]
    T5["<b>T5</b><br/>Proattività<br/>———<br/>salute · colli"]
    T6["<b>T6</b><br/>Q&A<br/>———<br/>pgvector"]

    T0 --> T1 --> T2 --> T3 --> T4 --> T5 --> T6

    classDef quasi fill:#eab308,stroke:#ca8a04,color:#000
    classDef stella fill:#e5e7eb,stroke:#7c3aed,color:#6b7280,stroke-width:3px
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class T0 quasi
    class T2 stella
    class T1,T3,T4,T5,T6 todo
```

---

## 3. Cosa è vivo, e dove

| Ambiente | Stato | Dettaglio |
|---|---|---|
| **Locale** | ✅ funzionante | `npm run dev`, giro di accesso completo provato |
| **Neon (Postgres)** | ✅ attivo | 6 tabelle, 2 migrazioni applicate, database vuoto di dati |
| **CI (GitHub Actions)** | ✅ configurata | typecheck, lint, test, build, confini |
| **Vercel** | ❌ **inesistente** | nessun `vercel.json`, nessun `.vercel`, il dominio risponde `X-Vercel-Error: NOT_FOUND` |
| **Upstash QStash** | ⬜ non serve ancora | chiavi presenti, primo uso previsto a T5 |

### Perché Vercel manca

Il progetto non è mai stato collegato a Vercel. Non è una dimenticanza tecnica: è un
passaggio che richiede **un accesso interattivo al pannello** e la scelta di quale
branch pubblicare, quindi non è automatizzabile da un agente.

Finché `main` resta al commit di scaffolding, pubblicarlo mostrerebbe comunque solo
la pagina iniziale: il deploy ha senso **dopo** il merge dell'integrazione.

---

## 4. Il collo di bottiglia attuale

```mermaid
graph LR
    A["6 branch<br/>di lavoro"] -->|"integrati"| B["integration/t0<br/>✅ 155 test"]
    B -->|"PR #2 ✅"| C["main<br/>aggiornato"]
    C -->|"collegamento<br/>👤 serve una persona"| D["Vercel<br/>online"]

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef bloccato fill:#f97316,stroke:#c2410c,color:#fff
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class A,B,C fatto
    class D bloccato
```

Il codice di T0 è **in `main`**. Resta un solo passaggio, e richiede una persona:
**collegare il repository a Vercel** e impostare le variabili d'ambiente, perché
serve accesso al pannello.

Finché non è fatto, T0 non è ancora *dimostrabile*: la roadmap chiede «ci si
registra come azienda **ed è online**». Procedura in
[`messa-in-linea.md`](messa-in-linea.md).

---

## 5. Debito registrato

Cose note e volutamente rimandate, non sviste:

| Voce | Dove è documentata | Quando va affrontata |
|---|---|---|
| Nessuna limitazione di frequenza sull'accesso | `AGENTS.md` §8.1 | prima di qualunque esposizione pubblica |
| Revoca di `Membership` non immediata | ADR-0006 | prima di un uso reale |
| Nessuna verifica dell'indirizzo email | ADR-0006 | dopo il PoC |
| Nessun recupero password | — | dopo il PoC |
| `npm run test:e2e` è un segnaposto | — | quando le pagine si moltiplicano |
| Registrazione dal browser non provata end-to-end | — | serve Playwright |

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
