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
| `AUTH_GITHUB_ID` | facoltativa | applicazione OAuth **di produzione** |
| `AUTH_GITHUB_SECRET` | facoltativa | idem |
| `LOG_LEVEL` | no | se vuota: `info` in produzione |
| `DATABASE_URL_UNPOOLED` | no | serve solo alle migrazioni, già applicate |
| `LLM_PROVIDER` | da T3 | `gemini` \| `groq` \| `fake` |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | da T3 | **una per fornitore**, mai una condivisa (ADR-0005) |
| `JOB_SECRET`, `QSTASH_*` | da T5 | job schedulati |

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

> **⚠️ Attenzione a `LLM_API_KEY`.** Su Vercel oggi esiste una variabile chiamata
> `LLM_API_KEY`, una chiave sola per tutti i fornitori. **Il codice non la
> leggerà mai.** ADR-0005 prevede una chiave **per fornitore** —
> `GEMINI_API_KEY` e `GROQ_API_KEY` — e il motivo è scritto lì: *«una riserva che
> richiede di riscrivere a mano la credenziale non è una riserva»*. Il passaggio
> al fornitore di scorta deve costare il cambio di una sola variabile, non uno
> scambio di segreti sotto pressione durante una dimostrazione.
>
> Va rinominata quando arriverà il gateway di T3. Fino ad allora è innocua:
> `LLM_PROVIDER=fake` non fa alcuna chiamata di rete e non legge alcuna chiave.
> Il fallimento sarebbe silenzioso — nessun errore, semplicemente il fornitore
> risulterebbe non configurato — quindi vale la pena saperlo prima.

### Passi

1. Su [vercel.com/new](https://vercel.com/new), **Import Git Repository** →
   `dibari62/scrum-master-ai`.

2. Vercel riconosce Next.js da solo: **non toccare** comandi di build o directory.

3. Apri **Environment Variables** e inserisci le variabili della tabella sopra,
   per gli ambienti *Production*, *Preview* e *Development*.

   Genera un `AUTH_SECRET` nuovo, senza riusare quello locale:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Un segreto condiviso fra il portatile di uno sviluppatore e la produzione
   significa che un portatile compromesso permette di falsificare le sessioni
   dell'ambiente reale.

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

## Dopo la messa in linea

Aggiorna [`docs/stato-progetto.md`](stato-progetto.md): la casella «Vercel · deploy»
passa da grigia a verde, e il diagramma del collo di bottiglia perde l'ultimo
riquadro arancione. Il traguardo T0 è dimostrabile solo a quel punto: *«ci si
registra come azienda ed è online»*.
