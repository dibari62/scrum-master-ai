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

**Un titolo con spazi non sopravvive a `npm run --`.** Fra PowerShell e lo
script ci sono tre interpreti — PowerShell, `cmd`, `npm` — e ognuno si mangia un
livello di virgolette: un titolo scritto fra apici arriva allo script troncato,
o ridotto a una virgoletta sola. È successo davvero, e la PR è nata con il nome
del file al posto del titolo. Quando un argomento contiene spazi, si salta `npm`
e si chiama direttamente `node`, che riceve gli argomenti da PowerShell senza
passaggi intermedi:

```powershell
& node scripts/github.mjs pr-title dibari62 scrum-master-ai <numero> 'Titolo con spazi'
```

`pr-title` serve proprio a rimediare a un titolo sbagliato senza chiudere e
riaprire la pull request.

`pr-merge` **rifiuta** di procedere se i controlli sono rossi o ancora in corso.
Il rifiuto è la ragione per cui lo script esiste: automatizzare un merge saltando
la verifica industrializzerebbe l'errore che la regola R5 vieta, invece di
eliminarlo.

**Aveva un buco, ed è stato chiuso dopo che si è manifestato.** GitHub espone due
cose diverse con nomi simili: i *check run* (i singoli controlli) e i *workflow
run* (le esecuzioni della pipeline). Un workflow in coda **non ha ancora creato i
suoi check run** — quindi una pull request con la sola spunta verde di Vercel e
l'intera suite di test ancora ferma appariva identica a una che aveva passato
tutto, e `pr-merge` avrebbe mergiato.

È successo davvero, sulla PR #50. Ora la guardia legge entrambe le fonti e
risponde così:

```
rifiuto: controlli ancora in corso — CI (queued)
```

E quando il dubbio è «perché la pipeline non parte», la domanda ha un comando
suo, che distingue «non ancora partita» da «in coda» da «finita»:

```powershell
npm run gh -- runs dibari62 scrum-master-ai <ramo>
```

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
| `npm run seed` | **prova a vuoto**: dice cosa farebbe e su quale database |
| `npm run seed -- --conferma` | ricarica i dati sintetici (cancella e riscrive solo i propri) |
| `npm run db:inspect` | cosa c'è davvero nel database — `tables`, `tenants`, `sprints` |
| `npm run dev:user -- add admin` | account temporaneo per ispezionare pagine protette |
| `npm run dev:user -- remove` | **lo rimuove: non dimenticarlo** |
| `npm run diagnose:tls -- <host>` | perché una connessione TLS fallisce |
| `npm run gh -- <comando>` | pull request, stato della CI, deploy e verifica del sito |
| `npm run qstash -- <comando>` | schedulazioni del controllo automatico su Upstash |
| `npm run db:duplicates` | cerca dati duplicati e incoerenti, in sola lettura |
| `npm run libro` | quanto del libro è implementato, contato dalla mappa |
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

### La trappola del server riusato

Gli e2e non partono da `next dev`: costruiscono l'applicazione come in produzione
(`npm run build && npm start`) sulla porta **3210**. Fuori dalla CI, però,
`reuseExistingServer` è attivo: **se qualcosa è già in ascolto su quella porta,
Playwright lo usa così com'è, senza ricostruire nulla.**

È comodo — evita tre minuti di build a ogni esecuzione — ma ha un effetto
velenoso: dopo aver modificato il codice, i test misurano ancora la build
*precedente*. Il risultato non è un errore, è una **risposta sbagliata che sembra
giusta**: la correzione appena scritta risulta non aver funzionato, e si finisce a
cercare un secondo difetto che non esiste.

Il sintomo che la smaschera è la cifra **identica**: se un test falliva «di 41px»
e dopo la correzione fallisce ancora «di 41px», al pixel, non si sta misurando il
codice nuovo. Una correzione sbagliata cambia il numero; una build vecchia lo
lascia intatto.

Come uscirne:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3210 | Select-Object OwningProcess
Stop-Process -Id <numero> -Force
```

Alla successiva esecuzione Playwright ricostruisce da capo. Vale la pena fermare
quel server ogni volta che si modifica codice dell'interfaccia e si rieseguono
gli e2e.

### 5.bis Una *server action* non naviga, e `networkidle` mente

Costato un'ora, quindi merita un titolo suo.

Dopo aver premuto un pulsante che salva, la pagina sembrava non aggiornarsi: il
database aveva i valori nuovi, lo schermo mostrava i vecchi. Sembra un difetto
di cache, ed è la spiegazione che viene in mente per prima — infatti ho applicato
due correzioni plausibili prima di fermarmi a misurare.

**Non era l'applicazione.** Una *server action* di Next non è una navigazione:
aggiorna l'albero della pagina sul posto. Quindi `waitForLoadState("networkidle")`
si risolve **prima** che il ri-render arrivi, e uno script che legge la pagina in
quell'istante legge quella di prima.

Nel dubbio, si aspetta **l'elemento**, non la rete:

```js
await page.getByRole("button", { name: "Salva" }).click();
await expect(page.locator("[data-band]").first()).toBeVisible();
```

E il modo per distinguere in trenta secondi un difetto vero da questo abbaglio:
dopo il click, fare `page.reload()`. Se dopo il ricaricamento il valore c'è ma
prima no, il codice funziona e a mentire è la sonda.

---

### 5.ter `Add-Content` corrompe gli accenti, e il typecheck non se ne accorge

`Add-Content` senza `-Encoding utf8` scrive nella **codifica di sistema**, non in
UTF-8. Su un file che era UTF-8 il risultato è un file misto: la parte vecchia
valida, la nuova no. Ogni `è`, `à`, `—` aggiunto diventa un byte solo che UTF-8
non sa leggere.

**La parte insidiosa è chi se ne accorge e chi no.**

| Strumento | Reazione |
|---|---|
| `npm run typecheck` | **passa**: TypeScript sostituisce i byte illeggibili e va avanti |
| `npm run test` | **passa**, per la stessa ragione |
| `npm run lint` | **passa** |
| `npm run build` | **fallisce**: `failed to convert rope into string` |

Quindi `npm run verify` resta verde e la CI si rompe — ed è successo, con un
messaggio che non nomina il vero problema: parla di *rope*, non di accenti.

Due regole che lo evitano:

- per **aggiungere** testo a un file, usare gli strumenti di modifica, non
  `Add-Content`. Se proprio serve PowerShell: `Add-Content -Encoding utf8`;
- prima di aprire una PR che tocca file con accenti, `npm run build` — è l'unico
  dei quattro comandi che se ne accorge.

Per trovarli dopo, la prova è il **giro di andata e ritorno**: si decodifica il
file come UTF-8, lo si ricodifica, e si confrontano i byte. Se non coincidono, il
file è misto.

### 5.quater `process.env.NOME` legge il vuoto della build, non il valore vero

**Il guasto più costoso finora, e quello che somigliava di meno a un guasto.**

Una variabile configurata correttamente su Vercel risultava **assente** al
server. Il portale rifiutava di conservare le chiavi dei modelli dicendo che
mancava `SECRETS_KEY`, e `SECRETS_KEY` c'era.

La causa: **Next.js sostituisce a tempo di build le occorrenze letterali di
`process.env.NOME` con il loro valore.** Per la maggior parte delle variabili è
innocuo. Non lo è per quelle che **in fase di build non esistono ancora**: su
Vercel una variabile di tipo *Secret* è disponibile solo al runtime, quindi il
bundler la sostituisce con una **stringa vuota**, e quel vuoto resta inciso nel
pacchetto per sempre.

```ts
// NON funziona: il letterale viene congelato a "" durante la build,
// quando la variabile ancora non esiste
function processEnvironment() {
  return { SECRETS_KEY: process.env.SECRETS_KEY };
}

// Funziona: un accesso calcolato non è sostituibile, quindi al runtime
// si legge ciò che la piattaforma ha davvero iniettato
function processEnvironment() {
  return process.env as unknown as Record<string, string | undefined>;
}
```

| Strumento | Reazione |
|---|---|
| typecheck, lint, test | **passano** (in locale la variabile esiste già in fase di build) |
| `npm run build` | **passa** |
| il sito in produzione | la variabile risulta assente |

**Perché è costato tanto.** Il sintomo — «manca la chiave di custodia» —
puntava con precisione verso la configurazione, che era giusta. Ogni verifica la
confermava assente, quindi ogni tentativo rafforzava l'ipotesi sbagliata: si
rigenera la chiave, si controlla l'ambiente, si rifà il deploy, si cerca un
secondo progetto Vercel. Nessuna di quelle strade poteva finire da nessuna
parte.

> **Un rimedio andò nella direzione opposta e peggiorò le cose.** La prima
> diagnosi fu «il bundler non vede gli accessi calcolati, quindi servono
> riferimenti letterali». Sembrava ragionevole, spiegava perché `DATABASE_URL`
> funzionava, e produsse un cambiamento che rese il difetto **sistematico**
> invece che accidentale. Vale la pena ricordarlo: una spiegazione che rende
> conto dei fatti noti non è ancora una spiegazione giusta.

**Come si è trovato.** Una pagina di diagnostica che si è **contraddetta da
sola**: `Object.keys(process.env)` elencava il nome — quindi al runtime la
variabile c'è — e la riga accanto lo dava per vuoto. Le uniche due che
«funzionavano», `DATABASE_URL` e `AUTH_SECRET`, sono quelle disponibili anche in
fase di build.

Da qui la regola: **una variabile d'ambiente si legge dall'oggetto, mai per
nome letterale.** Il parametro iniettabile resta — serve ai test — ma il valore
predefinito è `process.env` letto come oggetto.

Due test la difendono da una futura «pulizia», e guardano il **sorgente**
invece del comportamento: è una delle poche volte in cui ha senso, perché in
locale le due forme si comportano in modo identico e nessun test funzionale
potrebbe distinguerle.

`/organizzazione/ambiente` esiste per questo: dice cosa il server vede davvero,
quante variabili ha in tutto, da quale commit sta rispondendo, e **segnala le
variabili che il pacchetto ha congelato a vuoto**.

### 5.quinquies Su Vercel, il tipo «Secret» non arriva al runtime

**La causa vera**, accertata per misura dopo quattro ipotesi sbagliate.

Aggiungendo una variabile, Vercel chiede un **tipo**:

| Tipo | Come si presenta | Cosa arriva al processo |
|---|---|---|
| **Secret** | «You can't reveal this value after saving. Use for passwords, API keys, and tokens.» | il nome, con **valore vuoto** |
| **Config** | «Readable after saving for members with access.» | nome e valore |

La descrizione di «Secret» nomina esattamente il caso d'uso — password, chiavi
API, token — quindi è la scelta che chiunque farebbe per una chiave di
cifratura. Ed è quella che non funziona.

**Il rimedio**: cancellare la variabile e ricrearla con **Type: Config**.

«Config» non significa pubblica: resta visibile a chi ha accesso al progetto
Vercel, che qui è una persona sola. Il compromesso è dichiarato — *una chiave
che non arriva non protegge nulla, blocca soltanto il portale.*

#### Come è stata accertata, e perché è costato quattro giri

Il sintomo — «manca la chiave di custodia» — puntava con precisione verso la
configurazione, che era giusta. Ogni verifica confermava che la variabile
mancava, quindi **ogni tentativo rafforzava l'ipotesi sbagliata**.

Quattro ipotesi, tutte plausibili, tutte compatibili con i fatti noti al
momento:

1. **progetto Vercel sbagliato** — smentita dal pannello;
2. **il bundler non risolve gli accessi calcolati** — corretta, nessun
   cambiamento;
3. **il pacchetto congela i letterali a vuoto** — corretta, nessun cambiamento;
4. **la variabile non è su *Production*** — smentita dal pannello.

La quinta volta non è stata proposta un'ipotesi: `/organizzazione/ambiente`
chiede la stessa variabile in **quattro forme** — letterale, oggetto,
`globalThis`, nome composto a runtime — e mostra quale risponde:

```
SECRETS_KEY                    AUTH_SECRET
  letterale:      no             letterale:      sì
  oggetto:        no             oggetto:        sì
  globalThis:     no             globalThis:     sì
  nome composto:  no             nome composto:  sì
```

`AUTH_SECRET` è il termine di paragone, ed è ciò che rende la misura
conclusiva: senza una variabile che sappiamo funzionare, quattro «no» non
distinguerebbero un guasto da una sonda scritta male.

Nessuna forma di lettura trova la variabile ⇒ **non è il codice**.

> **La lezione che vale più della chiave.** Una spiegazione che rende conto di
> tutti i fatti noti non è ancora una spiegazione giusta. Le ipotesi 2 e 3
> spiegavano perfettamente perché `DATABASE_URL` funzionasse e `SECRETS_KEY` no,
> ed erano entrambe sbagliate. Dopo il secondo tentativo fallito conviene
> smettere di ipotizzare e costruire lo strumento che **esclude**.

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
