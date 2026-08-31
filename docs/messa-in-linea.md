# Messa in linea

Come portare il lavoro da un branch di integrazione fino all'applicazione online.
Due operazioni distinte: **integrare** e **pubblicare**. Vanno fatte in quest'ordine.

---

## 1. Integrare un branch in `main`

> **Fatto per T0** — PR #2, mergiata il 20/08/2026. La procedura resta qui perché
> vale per ogni integrazione futura.

### Due account GitHub, e quale conta

Su questa macchina convivono due identità GitHub, ed è la fonte di un errore che
sembra insormontabile:

| Chi | Dove vive | Cosa può fare su questo repository |
|---|---|---|
| Account **aziendale** (Enterprise Managed User) | sessione di VS Code, server MCP, GitKraken | **niente in scrittura**: risponde `403` |
| Account **`dibari62`** | Git Credential Manager | tutto: è il proprietario del repository |

Il repository appartiene a `dibari62`, ma VS Code è autenticato con l'account
aziendale. Ne segue che ogni strumento integrato fallisce con
`403 Unauthorized: As an Enterprise Managed User…`, mentre `git push` funziona
senza problemi: git usa credenziali diverse, e sono quelle giuste.

**La conseguenza pratica:** per aprire una pull request non si passa
dall'interfaccia di VS Code, si usa il token che git già possiede.

```bash
git credential fill      # protocol=https, host=github.com
```

restituisce `username=dibari62` e il token associato, spendibile sull'API REST
di GitHub. Con quello, una pull request si apre da riga di comando senza toccare
l'interfaccia.

> Il token **non va mai** stampato, scritto su file, né passato come argomento
> di un comando: nell'elenco dei processi sarebbe visibile a chiunque sia sulla
> macchina. Va letto e usato nello stesso processo.

### Aprire la pull request

1. Apri il modulo già compilato, sostituendo il nome del branch:

   ```
   https://github.com/dibari62/scrum-master-ai/compare/main...NOME-BRANCH?expand=1
   ```

   Assicurati di essere autenticato su GitHub **come `dibari62`**, non con
   l'account aziendale: da quest'ultimo il pulsante non compare.

2. Clicca il pulsante verde **Create pull request**.

3. **Attendi la CI.** I controlli passano da un pallino giallo a una spunta verde
   in due o tre minuti. Se qualcosa diventa rosso, non forzare il merge: il
   problema è reale e va guardato.

4. **Merge pull request** → **Confirm merge**. Scegli *Create a merge commit*,
   non *Squash*: i sei commit di merge raccontano quale fetta ha introdotto cosa,
   e schiacciarli perde quella traccia.

5. Allinea la copia locale:

   ```bash
   git checkout main
   git pull
   ```

6. I branch già integrati si possono cancellare da GitHub. **`docs/spec-scrum-agent`
   no**: contiene termini di glossario per una specifica non ancora scritta.

---

## 2. Collegare il progetto a Vercel

### Prima di iniziare: cosa serve davvero

Il codice oggi legge **tre** variabili, più una che Auth.js richiede per conto suo.
Tutto il resto di `.env.example` serve a traguardi futuri e su Vercel si aggiunge
quando arriverà il momento.

| Variabile | Serve ora? | Valore |
|---|---|---|
| `DATABASE_URL` | **sì** | stringa Neon **pooled** (host con `-pooler`) |
| `AUTH_SECRET` | **sì** | valore casuale, **diverso** da quello di sviluppo |
| `SECRETS_KEY` | **sì** | 32 byte casuali in base64, **diversi** da quelli di sviluppo. Senza, il portale **rifiuta** le chiavi API e i token Jira dei progetti |
| `AUTH_GITHUB_ID` | facoltativa | applicazione OAuth **di produzione** |
| `AUTH_GITHUB_SECRET` | facoltativa | idem |
| `LOG_LEVEL` | no | se vuota: `info` in produzione |
| `DATABASE_URL_UNPOOLED` | no | serve solo alle migrazioni, già applicate |
| `LLM_PROVIDER`, `GEMINI_API_KEY`, `GROQ_API_KEY` | **no, mai più** | superate da ADR-0010: la chiave la porta il cliente, per progetto. Vedi il riquadro qui sotto |
| `JOB_SECRET`, `QSTASH_*` | quando ci sarà un job | oggi la lettura da Jira si avvia a mano |

> **`SECRETS_KEY` è la chiave con cui si custodiscono le chiavi altrui**, e va
> capito prima di generarla ([ADR-0010](architecture/ADR-0010-chiavi-del-cliente.md)).
>
> Dalla scheda «Dati» e «Modello» delle impostazioni, un cliente inserisce il
> proprio token Jira e la propria chiave del modello. Da quel momento sono **roba
> sua custodita da noi**: chi le ottiene può spendere i suoi soldi e leggere i
> suoi progetti. Prima di toccare il database vengono cifrate, e `SECRETS_KEY` è
> ciò che le apre.
>
> Ne discendono tre conseguenze pratiche:
>
> - **Senza, il portale rifiuta le credenziali invece di conservarle in chiaro.**
>   Non è un guasto: è la scelta di non ripiegare. La schermata lo dichiara in
>   cima — «questa installazione non ha una chiave di custodia» — quindi il
>   sintomo è «non riesco a salvare la chiave del modello».
> - **Dev'essere diversa da quella di sviluppo**, per la stessa ragione di
>   `AUTH_SECRET`: un portatile compromesso non deve aprire i segreti della
>   produzione.
> - **Cambiarla rende illeggibile tutto ciò che è già stato cifrato.** Non si
>   perde nulla di irrecuperabile — le credenziali si reinseriscono — ma il
>   portale dirà che non sono configurate, e va saputo prima e non dopo.

Senza `AUTH_GITHUB_ID` e `AUTH_GITHUB_SECRET` l'applicazione funziona: il pulsante
«Continua con GitHub» semplicemente non compare, e resta l'accesso con email e
password.

> **`AUTH_URL` non va impostata, e non è un dettaglio.** La configurazione usa
> `trustHost: true`, quindi Auth.js ricava l'indirizzo dalla richiesta. Se invece
> la variabile è presente, **vince lei** — anche se punta altrove.
>
> Verificato: con `AUTH_URL=http://localhost:3000` ereditata da `.env.local`, un
> accesso riuscito sul server in ascolto sulla porta 3100 rimanda comunque a
> `http://localhost:3000/`. La sessione viene creata correttamente, ma l'utente
> finisce su un indirizzo che in produzione non esiste.
>
> È il motivo per cui **non si copia `.env.local` dentro Vercel**: si inseriscono
> solo le variabili della tabella qui sopra, una per una.

> **⚠️ `LLM_API_KEY` e `LLM_PROVIDER` su Vercel si possono cancellare.** Erano
> l'impostazione precedente: una chiave nostra, uguale per tutti i progetti.
> **Il codice non le legge più**, e non è un rinvio.
>
> [ADR-0010](architecture/ADR-0010-chiavi-del-cliente.md) ha cambiato la
> premessa: ogni progetto porta **la propria** chiave, inserita dalla scheda
> «Modello» delle sue impostazioni, e ogni esecuzione costruisce il gateway da
> lì. Non esiste più un gateway dell'applicazione — un gateway riusato
> servirebbe il rapporto di un'azienda con la chiave di un'altra, e **nessun
> test se ne accorgerebbe**, perché il testo prodotto sarebbe corretto.
>
> Lasciarle non fa danno, ma sono ingannevoli: qualcuno le troverà e penserà che
> configurare il modello si faccia lì.

### Passi

1. Su [vercel.com/new](https://vercel.com/new), **Import Git Repository** →
   `dibari62/scrum-master-ai`.

2. Vercel riconosce Next.js da solo: **non toccare** comandi di build o directory.

3. Apri **Environment Variables** e inserisci le variabili della tabella sopra,
   per gli ambienti *Production*, *Preview* e *Development*.

   Genera `AUTH_SECRET` e `SECRETS_KEY` nuovi, senza riusare quelli locali.
   Nel terminale di VS Code (*Terminale → Nuovo terminale*):

   ```powershell
   npm run chiave
   ```

   Il comando genera 32 byte casuali, li mette **negli appunti** — quelli di
   `Ctrl+V` — e stampa dove incollarli. Il valore non finisce a schermo: un
   segreto stampato resta nella cronologia della shell, nello scrollback e —
   quando alla tastiera c'è un agente — nella trascrizione di una conversazione
   inviata a terzi. Con `npm run chiave -- --mostra` lo si vede comunque, ed è
   una scelta che spetta a chi possiede il segreto.

   > `npm run <nome>` è una **scorciatoia** definita in `package.json`, non un
   > comando di sistema. Spiegazione per esteso, con il ponte verso l'AS/400, in
   > [`dall-as400-al-web.md`](dall-as400-al-web.md) §4.bis.

   > **⚠️ Il tipo va scelto «Config», non «Secret».** Vercel propone due tipi, e
   > la descrizione di *Secret* nomina esattamente questo caso d'uso —
   > «passwords, API keys, and tokens». È la scelta che chiunque farebbe, ed è
   > **quella che non funziona**: una variabile *Secret* raggiunge il processo
   > con il nome presente e il **valore vuoto**, quindi il portale la vede come
   > mancante e rifiuta di conservare credenziali.
   >
   > Il sintomo non somiglia alla causa e costa giorni: nel pannello la
   > variabile è lì, su *Production*, aggiunta pochi minuti prima. Accertato per
   > misura in [`ripartire-da-zero.md`](ripartire-da-zero.md) §5.quinquies, dopo
   > quattro ipotesi sbagliate.
   >
   > *Config* non significa pubblica: resta visibile a chi ha accesso al
   > progetto Vercel. Una chiave che non arriva non protegge nulla.

   Un segreto condiviso fra il portatile di uno sviluppatore e la produzione
   significa che un portatile compromesso permette di falsificare le sessioni
   dell'ambiente reale — o, per `SECRETS_KEY`, di aprire le credenziali dei
   clienti.

4. **Deploy.** Al termine annota l'indirizzo assegnato, del tipo
   `https://scrum-master-ai-<qualcosa>.vercel.app`.

5. **Applicazione OAuth GitHub per la produzione.** Un'applicazione OAuth accetta
   un solo URL di ritorno, quindi quella di sviluppo non vale online. Su
   *GitHub → Settings → Developer settings → OAuth Apps → New OAuth App*:

   | Campo | Valore |
   |---|---|
   | Homepage URL | `https://<il-tuo-dominio>.vercel.app` |
   | Authorization callback URL | `https://<il-tuo-dominio>.vercel.app/api/auth/callback/github` |

   Riporta identificativo e segreto nelle variabili di Vercel e **rilancia il
   deploy**: le variabili si leggono all'avvio, non a caldo.

---

## 3. Pubblicare un incremento successivo

Dopo il primo collegamento a Vercel, pubblicare significa soltanto **portare il
lavoro in `main`**: Vercel osserva quel branch e ricostruisce da solo. Non c'è
un pulsante «deploy» da premere.

Il giro completo, dalla riga di comando, senza toccare l'interfaccia di VS Code
(che è autenticata con l'account sbagliato, §1):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

git push -u origin <branch>
npm run gh -- pr-open   dibari62 scrum-master-ai <branch> main "<titolo>" .git/CORPO.md
npm run gh -- pr-status dibari62 scrum-master-ai <numero>   # attendi il verde
npm run gh -- pr-merge  dibari62 scrum-master-ai <numero>
git checkout main; git pull
```

`pr-merge` **si rifiuta** di procedere se un controllo è rosso o ancora in
corso. Non è una comodità: è R5 resa meccanica, perché un'automazione che
saltasse il controllo industrializzerebbe l'errore invece di toglierlo.

### Trovare l'indirizzo pubblicato, e verificarlo

L'indirizzo stabile del progetto è **<https://scrum-master-ai-swart.vercel.app>**.
Ogni deploy ne produce anche uno proprio, utile per guardare una versione
precisa:

```powershell
npm run gh -- deployments dibari62 scrum-master-ai
npm run gh -- ping https://<indirizzo>/
```

Il primo elenca gli ultimi cinque deploy di produzione con il commit da cui
vengono; il secondo chiede al sito se risponde, e riconosce il rimando a
`vercel.com/login` che significa «in piedi ma non pubblico».

> **Non indovinare l'indirizzo.** `scrum-master.vercel.app` risponde `200` e
> appartiene a un altro progetto. Una verifica frettolosa conclude «è online»
> guardando l'applicazione di qualcun altro — l'esito peggiore possibile,
> perché è un falso positivo che sembra una conferma.

---

## Verifica che sia davvero in piedi

**Prima cosa: il sito potrebbe essere protetto.** Vercel attiva in modo predefinito
*Deployment Protection*, che chiude il progetto a chiunque non sia autenticato sul
tuo account Vercel. Il sintomo è un rimando a `vercel.com/login` invece della
pagina iniziale:

```
302 Found
Location: https://vercel.com/sso-api?url=...
```

Non è un errore di configurazione: l'applicazione funziona, semplicemente non è
pubblica. Per aprirla:

**Project Settings → Deployment Protection → Vercel Authentication → Disabled**,
poi **Save**. Ha effetto subito, senza bisogno di un nuovo deploy.

Per una demo da mostrare a qualcuno va disattivata. Se invece il progetto deve
restare visibile solo a te, lasciala accesa e verifica dal browser in cui sei già
autenticato.

Poi:

| Cosa | Atteso |
|---|---|
| `/` | la pagina iniziale con i due pulsanti |
| `/registrati` | il modulo di registrazione |
| `/organizzazione` senza sessione | rimando a `/accedi` |
| registrazione di un'azienda di prova | crea l'account e porta all'area azienda |

La prima richiesta dopo un periodo di inattività può essere lenta: il piano
gratuito di Neon spegne il database e deve risvegliarlo.

Se un segreto finisce comunque in chiaro — in una chat, in un ticket, in un log —
**non basta rimuoverlo dal punto in cui è comparso**: va considerato compromesso e
sostituito alla fonte. Per Neon: *Roles → `neondb_owner` → Reset password*, poi
aggiornare `DATABASE_URL` e `DATABASE_URL_UNPOOLED` in `.env.local` e su Vercel.

---

## Tre trappole da conoscere

**Non copiare `.env.local` dentro Vercel.** È il gesto più naturale ed è quello che
rompe l'accesso: quel file contiene `AUTH_URL=http://localhost:3000`, e in
produzione manderebbe ogni utente appena autenticato su un indirizzo inesistente.
Inserisci solo le due variabili obbligatorie, a mano.

**Il build riesce anche senza nessuna variabile.** Verificato: nascondendo
completamente la configurazione, `next build` completa lo stesso. È comodo, ma
inganna — un deploy verde **non** dimostra che le variabili siano giuste. Se
`DATABASE_URL` manca o è sbagliata, te ne accorgi solo quando qualcuno prova a
registrarsi. Controlla sempre il giro completo, non il colore della spunta.

**Usa la stringa pooled.** Su Neon `DATABASE_URL` deve contenere `-pooler`
nell'host. Quella diretta funziona in locale e crolla in ambiente serverless, dove
ogni invocazione aprirebbe una connessione propria fino a esaurire il limite.

Infine: **Vercel Hobby vieta l'uso commerciale**. Legittimo per un proof-of-concept
(ADR-0001). Se il progetto cambiasse natura, cambia anche il piano necessario.

---

## 4. Separare sviluppo da produzione

> **Da fare, e serve la console Neon.** È l'unico passo di questo documento che
> un agente non può eseguire da solo: richiede di creare un branch nel progetto
> Neon.

Oggi sviluppo e produzione **usano lo stesso database**. È una semplificazione
consapevole — comoda per una dimostrazione, perché ciò che si vede online è
esattamente ciò che vede chi sviluppa — ed è registrata nel debito.

Ha però smesso di essere teorica. Il 24/08 un `npm run seed` di routine ha
riscritto i dati del sito pubblico. Non si è perso nulla, perché erano sintetici
e l'intenzione era proprio rigenerarli, ma lo stesso comando durante una
dimostrazione avrebbe svuotato lo schermo che qualcuno stava guardando.

Nel frattempo `npm run seed` è diventato una **prova a vuoto**: stampa l'host e
le righe che toccherebbe, e scrive solo con `--conferma`. Riduce il rischio, non
lo toglie.

### Come si separa

Neon offre il *branching* anche nel piano gratuito. Un branch è una copia del
database che parte dai dati di quello principale e poi vive per conto proprio:
è il modo previsto per avere un ambiente di sviluppo senza pagarne un secondo.

1. Console Neon → progetto → **Branches** → **New branch**, a partire da `main`.
   Chiamalo `development`.
2. Copia la sua stringa di connessione **pooled** (host con `-pooler`).
3. Sostituiscila in `.env.local`, sia in `DATABASE_URL` sia — nella variante non
   pooled — in `DATABASE_URL_UNPOOLED`.
4. **Non toccare le variabili su Vercel**: la produzione resta su `main`.
5. Verifica di aver davvero cambiato ambiente:

   ```powershell
   $env:NODE_OPTIONS = "--use-system-ca"
   npm run seed          # deve stampare l'host del branch, non quello di produzione
   ```

Da quel momento `docs/guardare-i-dati.md` va corretto: smette di essere vero che
il sito e il computer di sviluppo mostrano gli stessi dati.

### Cosa si sblocca

I **test end-to-end in CI**, che oggi sono il debito più costoso: settantacinque
test che girano solo quando qualcuno si ricorda di lanciarli. Non possono entrare
in CI finché l'unico database disponibile è quello che serve il sito pubblico —
alcuni registrano aziende, e una suite che crea e cancella dati non può puntare
alla produzione.

---

## 5. Accendere il controllo automatico

> **Due passi richiedono te**, perché toccano la console di Vercel. Finché non
> sono fatti, la rotta esiste e rifiuta ogni chiamata: è il comportamento
> giusto, non un guasto.

Il controllo automatico è ciò che distingue una dashboard da un assistente. La
salute dello sprint si calcola quando qualcuno apre la pagina, quindi senza
un'esecuzione schedulata **il giudizio di ieri non è mai stato calcolato**: non
esiste una storia, e non può esistere.

### Passo 1 — le variabili su Vercel *(serve la console)*

**Project Settings → Environment Variables**, ambiente *Production*:

| Variabile | Valore |
|---|---|
| `JOB_SECRET` | lo stesso valore che hai in `.env.local` |

Poi **rilancia il deploy**: le variabili si leggono all'avvio, non a caldo.

Solo `JOB_SECRET`. Le chiavi `QSTASH_*` servono a *questa* macchina per
registrare la schedulazione, non all'applicazione: il server verifica un segreto
condiviso, non parla mai con Upstash.

### Passo 2 — registrare la schedulazione

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

npm run qstash -- list
npm run qstash -- create https://scrum-master-ai-swart.vercel.app/api/jobs/sprint-health "0 6 * * *"
```

Le 6:00 UTC sono una proposta, non una decisione presa: presto abbastanza da
essere già calcolato quando qualcuno apre la dashboard la mattina, tardi
abbastanza da includere il lavoro della sera prima. Si cambia rimuovendo e
ricreando.

Il segreto viaggia come **intestazione inoltrata**, mai nell'indirizzo: un
indirizzo attraversa cronologia, log dei proxy e `referer`, e un segreto messo
lì è un segreto già speso.

Per fermarlo:

```powershell
npm run qstash -- delete <scheduleId>
```

### Passo 3 — registrare la rilettura da Jira

Il secondo job, e quello che il Product Owner nota davvero: senza, i dati
cambiano solo quando qualcuno preme «Leggi ora».

```powershell
npm run qstash -- create https://scrum-master-ai-swart.vercel.app/api/jobs/sync-projects "0 * * * *"
```

**Ogni ora, e non è la frequenza con cui si legge un progetto.** Questo timer
sveglia il portale; è il portale a decidere quali progetti siano scaduti,
guardando la frequenza scelta su ciascuno nella scheda «Dati». Un progetto
impostato su «una volta al giorno» viene letto una volta al giorno anche se il
timer suona ventiquattro volte.

> **Perché un timer solo invece di uno per progetto.** Con un'iscrizione per
> progetto la frequenza vivrebbe in due posti — nel portale e su QStash — e il
> giorno in cui qualcuno la cambia dall'interfaccia il servizio esterno
> resterebbe indietro senza che nulla lo segnali. Un solo timer e la decisione
> nel codice: la schermata è l'unica fonte di verità.

Il predefinito di ogni progetto è **`manual`**, quindi accendere questo job non
fa partire alcuna lettura finché qualcuno non sceglie una frequenza. È voluto:
la quota di chiamate a Jira è del cliente.

### Verificare senza aspettare domani

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
node -e "process.loadEnvFile('.env.local'); fetch('https://scrum-master-ai-swart.vercel.app/api/jobs/sprint-health',{method:'POST',headers:{authorization:'Bearer '+process.env.JOB_SECRET}}).then(r=>r.json()).then(console.log)"
```

Risponde con quanti progetti ha esaminato e quanti giudizi ha scritto. Due
esecuzioni nello stesso giorno lasciano **una** riga: un grafico con due punti
sullo stesso giorno suggerirebbe una variazione che non c'è stata.

Per la rilettura da Jira, lo stesso con l'altro indirizzo:

```powershell
node -e "process.loadEnvFile('.env.local'); fetch('https://scrum-master-ai-swart.vercel.app/api/jobs/sync-projects',{method:'POST',headers:{authorization:'Bearer '+process.env.JOB_SECRET}}).then(r=>r.json()).then(console.log)"
```

Risponde con quanti progetti ha guardato, quanti erano **scaduti**, quante righe
sono entrate e quanti hanno fallito. Su un'installazione in cui nessuno ha ancora
scelto una frequenza, `projectsDue` vale `0` — e non è un guasto: è il
predefinito che fa il suo mestiere.

Senza il segreto, o con quello sbagliato, risponde `401` e non scrive nulla.

---

## Dopo la messa in linea

Aggiorna [`docs/stato-progetto.md`](stato-progetto.md): la casella «Vercel · deploy»
passa da grigia a verde, e il diagramma del collo di bottiglia perde l'ultimo
riquadro arancione. Il traguardo T0 è dimostrabile solo a quel punto: *«ci si
registra come azienda ed è online»*.
