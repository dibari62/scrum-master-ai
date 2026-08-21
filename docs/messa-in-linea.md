# Messa in linea

Come portare il lavoro da un branch di integrazione fino all'applicazione online.
Due operazioni distinte: **integrare** e **pubblicare**. Vanno fatte in quest'ordine.

---

## 1. Integrare un branch in `main`

> **Fatto per T0** — PR #2, mergiata il 20/08/2026. La procedura resta qui perché
> vale per ogni integrazione futura.

### Perché serve una persona

`AGENTS.md` §5 vieta i commit diretti su `main`: si passa da una pull request.
Un agente non può aprirla. Le tre vie disponibili sono state provate tutte e
falliscono per la stessa ragione:

| Via | Esito |
|---|---|
| Server MCP GitHub | `403 Unauthorized: As an Enterprise Managed User…` |
| Integrazione GitHub di VS Code | stesso errore |
| GitKraken | richiede un accesso interattivo |

Il blocco è sull'**account**, non sullo strumento: un utente gestito da
un'azienda non può scrivere su un repository personale. Non c'è configurazione
che lo aggiri, quindi il passaggio resta manuale.

### Passi

1. Apri questo link: arriva direttamente al modulo, con titolo e descrizione già
   compilati.

   ```
   https://github.com/dibari62/scrum-master-ai/compare/main...integration/t0?expand=1
   ```

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
| `LLM_*`, `JOB_SECRET`, `QSTASH_*` | no | da T3 e T5 |

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

### Verifica che sia davvero in piedi

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
