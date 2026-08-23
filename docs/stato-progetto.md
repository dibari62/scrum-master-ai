# Stato del progetto

> Fotografia aggiornata a ogni fine sviluppo. Se una casella è verde, esiste **ed è
> stata verificata**; se è gialla è in corso; se è grigia non è ancora iniziata.
>
> Ultimo aggiornamento: **22/08/2026** — T0, T1, T2 e T3 in `main` (PR #2 → #18),
> applicazione online. Si crea uno Scrum Master AI in meno di dieci secondi.

---

## 1. I quattro livelli, a colpo d'occhio

```mermaid
graph TB
    subgraph SCH["🦴 Scheletro"]
        S1["Next.js 16 + TypeScript strict"]
        S2["Tailwind + shadcn/ui"]
        S3["Vitest · 572 test<br/>Playwright · 38 test e2e"]
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
        D2["Schema Drizzle<br/>19 tabelle create"]
        D3["Isolamento fra aziende<br/>verificato su Postgres vero"]
        D4["Entità Scrum<br/>Sprint · WorkItem · Transizioni"]
        D5["ScrumAgent · Contesto<br/>Registro esecuzioni"]
    end

    subgraph UI["🖥️ Interfaccia"]
        U1["Home"]
        U2["Registrazione"]
        U3["Accesso"]
        U4["Area azienda"]
        U5["Dashboard metriche"]
        U7["Elementi e storia<br/>degli stati"]
        U6["Scrum Master AI<br/>creazione e registro"]
        U8["Catalogo metriche<br/>come si calcola ogni numero"]
    end

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef corso fill:#eab308,stroke:#ca8a04,color:#000
    classDef todo fill:#e5e7eb,stroke:#9ca3af,color:#6b7280

    class S1,S2,S3,S4 fatto
    class I1,I2,I3 fatto
    class I4 todo
    class D1,D2,D3,D4,D5 fatto
    class U1,U2,U3,U4,U5,U6,U7,U8 fatto
```

**Come leggerlo:** tutto ciò che si vede è stato verificato in un browser, non solo
dai test. Ogni numero della dashboard è **apribile** fino alla storia degli stati da
cui è calcolato, e un progetto può avere il proprio Scrum Master AI con un registro
delle esecuzioni. Le pagine sono verificate **a 375, 640, 768 e 1280 pixel**: nessun
testo sotto i 10 pixel resi, nessuno sbordamento laterale. Restano da costruire le
**skill** — le capacità che producono report e digest — che sono T4.

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

    class T0,T1,T2,T3 fatto
    class T4 prossimo
    class T5,T6 todo
```

**T2 è il traguardo che dà credibilità al resto**: tutti i numeri che
l'applicazione mostra sono calcolati da codice deterministico e testato. Nessun
modello linguistico li ha toccati.

**T3 ha costruito l'oggetto e l'infrastruttura, non le capacità.** Esiste lo
Scrum Master AI di un progetto, esiste il gateway verso un modello con budget e
fornitore di riserva, esiste il registro che annota costo ed esito di ogni
esecuzione. Ma nessun report è ancora stato prodotto: quello è T4, ed è lì che la
regola R1 — il codice calcola, l'LLM racconta — smetterà di essere teorica.

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
    D --> E["T4<br/>prime skill"]

    classDef fatto fill:#16a34a,stroke:#15803d,color:#fff
    classDef corso fill:#eab308,stroke:#ca8a04,color:#000

    class A,B,C,C1,D fatto
    class E corso
```

**T4 è cominciato.** La specifica di `sprint-report` è scritta, e il nucleo che la
rende possibile esiste ed è testato: la selezione deterministica dell'evidenza,
l'istantanea che scrive ogni numero, e il controllo di fedeltà numerica. Manca la
chiamata al modello, la persistenza del report e la schermata.

**T2.1 non era in roadmap.** È nato da un'osservazione del Product Owner: la
dashboard dichiarava un cycle time mediano su 44 elementi e non c'era modo di
vedere quali. Un numero in cui non si può entrare è un numero che si deve
accettare per fede.

**T3 è dimostrabile e cronometrato:** dalla dashboard alla scheda dell'agente con
un'esecuzione registrata, in meno di dieci secondi, senza digitare nulla oltre a
confermare i valori proposti. La roadmap chiedeva due minuti.

Nessun passaggio è più bloccato su una persona. Restano **tre** cose che
attendono il Product Owner, nessuna delle quali ferma lo sviluppo:

| Questione | Dove | Effetto se non decisa |
|---|---|---|
| **Q2** — un elemento bloccato fa parte del carico? | [glossario](domain-glossary.md) | il WIP continua a escluderlo |
| `LLM_API_KEY` su Vercel va rinominata | [messa-in-linea](messa-in-linea.md) | nessuno finché il provider è `fake`; con un fornitore vero la chiave non verrebbe letta |
| Rotazione della password Neon | §5 qui sotto | nessuno finché i dati sono sintetici |

Le **otto questioni aperte** della specifica di T3 hanno tutte una risposta
provvisoria motivata. Tre sono già state decise (Q3, Q4 e Q6) applicando lo stesso
criterio: **fra due scelte difendibili si prende quella reversibile**, e su
un'autorizzazione non si sceglie mai la permissiva in silenzio.

---

## 5. Debito registrato

Cose note e volutamente rimandate, non sviste:

| Voce | Dove è documentata | Quando va affrontata |
|---|---|---|
| **I test end-to-end non girano in CI** | [flusso di lavoro](agent-workflow.md) §3.1 | serve un database separato dai dati mostrati online. Ha già lasciato passare un difetto: l'intestazione fissa che rubava i clic |
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
| L'agente `product-analyst` ha consegnato metà lavoro su T4 | — | ha scritto il vocabolario e non la specifica, lasciando un rimando a un file inesistente. Verificare sempre la consegna, non fidarsi del resoconto |
| `npm run test:e2e` è un segnaposto | — | ~~quando le pagine si moltiplicano~~ **fatto**: 38 test Playwright su Chrome |
| Registrazione dal browser non provata end-to-end | — | ~~serve Playwright~~ **fatto** |
| Strumenti di lavoro fuori dal repository | — | ~~sparirebbero con la sessione~~ **fatto**: PR #14 |
| Le pagine non erano mai state provate su uno schermo stretto | — | ~~mai misurato~~ **fatto**: le etichette dei grafici si rendevano a 3,9 pixel su telefono |

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
