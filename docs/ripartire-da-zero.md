# Ripartire da zero

Cosa fare se la cartella locale sparisce, se serve lavorare da un'altra macchina, o
se qualcun altro — persona o agente — riprende questo progetto da capo.

> **La domanda a cui questo documento risponde:** *«se cancello la cartella in
> locale, lo sviluppo può continuare ugualmente?»*
>
> **Sì.** Tutto ciò che serve a capire *cosa* è il progetto, *perché* è fatto così
> e *come* si lavora è versionato su GitHub. Quello che non è versionato è
> elencato al §4, con le istruzioni per ricrearlo.

---

## 1. Cosa sopravvive, e dove

Il repository **è** la memoria del progetto. Non ci sono decisioni importanti che
vivono solo nella testa di qualcuno o in una conversazione.

| Se vuoi sapere… | Leggi |
|---|---|
| Le regole non negoziabili, la struttura, i vincoli | [`AGENTS.md`](../AGENTS.md) — **si legge per primo** |
| *Perché* una scelta tecnica è stata fatta così | [`docs/architecture/`](architecture/) — un ADR per decisione |
| Come si chiamano le cose, e cosa non si deve dire | [`docs/domain-glossary.md`](domain-glossary.md) |
| A che punto siamo davvero | [`docs/stato-progetto.md`](stato-progetto.md) |
| Cosa viene prima e cosa dopo | [`docs/roadmap.md`](roadmap.md) |
| Come lavorano insieme gli agenti | [`docs/agent-workflow.md`](agent-workflow.md) |
| Cosa fa ogni agente specializzato | [`.github/agents/`](../.github/agents/) |
| Le regole valide in una zona del codice | [`.github/instructions/`](../.github/instructions/) |
| Cosa deve fare una funzionalità, prima di scriverla | [`specs/`](../specs/) |
| Il ponte fra AS/400 e questo mondo | [`docs/dall-as400-al-web.md`](dall-as400-al-web.md) |
| Come guardare i dati con i propri occhi | [`docs/guardare-i-dati.md`](guardare-i-dati.md) |

**Perché questo è insolito, e voluto.** In molti progetti la documentazione è un
riassunto scritto dopo, che invecchia male. Qui `AGENTS.md` e gli ADR sono
*istruzioni operative*: ogni agente AI che apre il repository li legge prima di
proporre una modifica. Se sono sbagliati, il codice esce sbagliato. Questo li
tiene onesti.

---

## 2. Rimettere in piedi una macchina

```powershell
git clone https://github.com/dibari62/scrum-master-ai.git
cd scrum-master-ai
npm ci
```

`npm ci` — non `npm install` — installa **esattamente** le versioni registrate in
`package-lock.json`. Serve a garantire che due macchine ottengano le stesse
librerie: `install` è libero di aggiornare qualcosa, `ci` no.

Poi le variabili d'ambiente (i segreti, che non sono nel repository):

```powershell
Copy-Item .env.example .env.local
node scripts/generate-secrets.mjs
```

Procedura completa, con dove prendere ogni valore:
[`docs/setup-ambiente.md`](setup-ambiente.md).

Infine la verifica che tutto funzioni:

```powershell
npm run verify
```

Se passa, la macchina è a posto. Se non passa, il problema è lì e non altrove.

---

## 3. Dietro un proxy che ispeziona il traffico

Su una rete aziendale con ispezione TLS (qui: **Cisco Umbrella**) ogni connessione
verso Neon o verso un servizio esterno fallisce con un errore di certificato.

**Diagnosi:**

```powershell
npm run diagnose:tls -- <host>
```

Lo script stampa la catena dei certificati e *chi li ha emessi*. Se in cima trova
un nome aziendale invece di un'autorità pubblica, il traffico è ispezionato.

**Rimedio:**

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

Dice a Node di fidarsi del deposito certificati di Windows, dove il certificato
aziendale è già installato. **La verifica resta attiva.**

> ⚠️ Esiste una scorciatoia, `NODE_TLS_REJECT_UNAUTHORIZED=0`, che si trova
> ovunque su internet. **Non va usata.** Non aggira il problema: spegne il
> controllo che rende sicura la connessione, per tutto il processo. È la
> differenza fra «insegnare al programma a riconoscere il timbro dell'azienda» e
> «smettere di guardare i timbri».

**Eccezione, una sola.** `scripts/diagnose-tls.mjs` disattiva la verifica al suo
interno — perché con la verifica attiva l'handshake si interrompe *prima* che si
possa leggere il certificato, e lo script fallirebbe proprio nel caso che deve
spiegare. Non trasmette nulla: apre, legge, riferisce e chiude. Ispezionare non è
trasmettere.

### Un limite noto di `next build`

Il comando di costruzione **rifiuta** `--use-system-ca` in `NODE_OPTIONS`:

```
Error: Initiated Worker with invalid NODE_OPTIONS env variable
```

Non è un guasto: Next avvia processi paralleli che non accettano quel flag.
`next build` non ha bisogno del database, quindi va eseguito **senza** la
variabile. Serve invece per `npm run seed`, per i test di integrazione e per gli
script che parlano con Neon.

---

## 4. Cosa **non** è nel repository

Tre categorie, con il rimedio per ciascuna.

### 4.1 I segreti

`.env.local` contiene 15 variabili — `DATABASE_URL`, `AUTH_SECRET`, le chiavi dei
fornitori. È in `.gitignore` e **deve restarci**.

Si ricostruisce con `docs/setup-ambiente.md`. `AUTH_SECRET` e `JOB_SECRET` si
rigenerano con lo script; gli altri si recuperano dai pannelli di Neon e Vercel.

### 4.2 I due account GitHub

Su questa macchina convivono due identità, ed è la causa di un intoppo che
altrimenti costa ore:

| Chi | Cosa può fare |
|---|---|
| Account aziendale (VS Code, estensioni) | legge; **`403` su ogni scrittura** al repository personale |
| `dibari62` (Git Credential Manager) | è il proprietario: può tutto |

Chi apre una pull request dall'estensione di VS Code riceve `403` e conclude che
non ha i permessi. **Non è vero**: `git push` funziona, quindi Git ha un token
buono. `scripts/github.mjs` prende in prestito *quel* token per una chiamata:

```powershell
npm run gh -- pr-open   dibari62 scrum-master-ai <branch> main "titolo" corpo.md
npm run gh -- pr-status dibari62 scrum-master-ai <numero>
npm run gh -- pr-merge  dibari62 scrum-master-ai <numero>
npm run gh -- ci-log    dibari62 scrum-master-ai <numero>
```

`pr-merge` **rifiuta** di procedere se i controlli sono rossi o ancora in corso.
Il rifiuto è la ragione per cui lo script esiste: automatizzare un merge saltando
la verifica industrializzerebbe l'errore che la regola R5 vieta, invece di
eliminarlo.

### 4.3 I PDF in `book/`

Materiale di lettura sul mondo Agile e Scrum. Escluso dal versionamento perché
sono **opere di terzi**, alcune commerciali: un repository pubblico non è il posto
dove ridistribuirle.

Fa eccezione la *Scrum Guide 2020*, pubblicata con licenza Attribution ShareAlike
4.0: quella si può citare apertamente.

Serviranno a **T4 e T5**, quando bisognerà decidere cosa rende utile un report di
sprint e quali segnali indicano una squadra in difficoltà. Da quei testi
nasceranno note originali in `docs/`, con l'indicazione della fonte — mai
riproduzioni.

---

## 5. Gli strumenti di lavoro quotidiano

Tutti versionati, quindi disponibili su qualunque macchina.

| Comando | A cosa serve |
|---|---|
| `npm run verify` | typecheck + lint + test + confini. **Un lavoro è finito solo se passa** |
| `npm run dev` | applicazione in locale, porta 3000 |
| `npm run seed` | ricarica i dati sintetici (cancella e riscrive solo i propri) |
| `npm run db:inspect` | cosa c'è davvero nel database — `tables`, `tenants`, `sprints` |
| `npm run dev:user -- add admin` | account temporaneo per ispezionare pagine protette |
| `npm run dev:user -- remove` | **lo rimuove: non dimenticarlo** |
| `npm run diagnose:tls -- <host>` | perché una connessione TLS fallisce |
| `npm run gh -- <comando>` | pull request dalla riga di comando |
| `npm run db:duplicates` | cerca dati duplicati e incoerenti, in sola lettura |
| `npm run test:e2e` | Playwright su Chrome (richiede `RUN_E2E=1`) |

**Il ruolo dell'account temporaneo non è un dettaglio.** Senza argomento,
`dev:user -- add` crea un `member`, ed è la scelta giusta come impostazione
predefinita: la maggior parte delle schermate va provata con i permessi più
scarsi. Ma generare un resoconto o eseguire una verifica richiede
`owner`/`admin`, quindi la suite end-to-end fallisce due test con un account
`member` — e fallisce dicendo «elemento non visibile», che sembra un difetto
dell'interfaccia e non un problema di permessi.

Per far girare tutta la suite serve `npm run dev:user -- add admin`.

`db:inspect` è **in sola lettura per costruzione**: non contiene `insert`,
`update` né `delete`. Scrivere su un database condiviso da uno script di comodo è
il modo più rapido per distruggere i dati di una dimostrazione.

---

## 6. Il vincolo che vale più di tutti

> Un'applicazione funzionante che il Product Owner non ha capito è un
> **fallimento**, non un successo parziale.

È la regola **R6** di `AGENTS.md`, e chiunque riprenda questo progetto la eredita.
Il Product Owner viene da trent'anni di IBM AS/400: sa progettare software, e lo sa
fare bene. Quello che sta imparando è l'ecosistema *fuori* da quella piattaforma.

Ne discende un obbligo pratico: **spiegare il perché, non solo il cosa**, e
introdurre ogni concetto nuovo la prima volta che compare. Un agente che consegna
in fretta qualcosa di opaco sta lavorando contro lo scopo del progetto, anche se il
codice è corretto.

---

## 7. Se riprendi il progetto oggi, nell'ordine

1. **[`AGENTS.md`](../AGENTS.md)** — le sei regole. Senza queste, il resto non si
   spiega.
2. **[`docs/stato-progetto.md`](stato-progetto.md)** — dove siamo davvero, debito
   compreso.
3. **[`docs/roadmap.md`](roadmap.md)** — cosa viene dopo.
4. **[`docs/architecture/`](architecture/)** — il *perché* delle scelte; leggi
   almeno ADR-0002 (le metriche non le calcola l'LLM) e ADR-0004 (le skill sono
   funzioni tipizzate, non agenti liberi).
5. **[`specs/`](../specs/)** — la specifica del traguardo in corso.
6. `npm run verify` — se passa, l'ambiente è a posto e puoi cominciare.
