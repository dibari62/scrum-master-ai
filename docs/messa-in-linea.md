# Messa in linea

Come portare il lavoro da un branch di integrazione fino all'applicazione online.
Due operazioni distinte: **integrare** e **pubblicare**. Vanno fatte in quest'ordine.

---

## 1. Integrare `integration/t0` in `main`

### Perché serve una persona

`AGENTS.md` §5 vieta i commit diretti su `main`: si passa da una pull request.
Un agente non può aprirla — le integrazioni GitHub disponibili su questa macchina
non hanno permessi di scrittura sul repository — quindi il passaggio è manuale.

### Passi

1. Apri la pagina di confronto:
   `https://github.com/dibari62/scrum-master-ai/compare/main...integration/t0`

2. **Create pull request**. Titolo suggerito:

   ```
   feat: fondamenta T0 — dominio, persistenza multi-azienda, autenticazione
   ```

   Nella descrizione conviene elencare le sei fette, perché la PR è ampia e la
   storia dei commit è l'unico modo per rileggerla a pezzi:

   ```markdown
   Integra sei branch, già verificati singolarmente:

   1. `chore/neon-direct-url` — ambiente locale e connessione diretta a Neon
   2. `docs/adr-llm-provider` — ADR-0005, scelta del provider LLM
   3. `feat/tenancy-model` — modello canonico Zod delle entità di tenancy
   4. `feat/db-tenancy` — schema Drizzle e accesso filtrato per organizzazione
   5. `feat/auth-foundation` — ADR-0006, Auth.js, password con scrypt
   6. `feat/auth-ui` — registrazione, accesso, area azienda

   `npm run verify`: 147 test superati, 8 saltati (integrazione su database).
   `next build` completo. Migrazioni già applicate su Neon.
   ```

3. **Attendi la CI.** Deve diventare verde su typecheck, lint, test, build e
   confini architetturali. Se fallisce, non forzare il merge: il problema è reale.

4. **Merge**. Usa *Create a merge commit*, non *Squash*: i sei commit di merge
   raccontano quale fetta ha introdotto cosa, e schiacciarli perde quella traccia.

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

> **`AUTH_URL` non serve.** La configurazione usa `trustHost: true`, quindi Auth.js
> ricava l'indirizzo dalla richiesta. Impostarla a mano è un modo per sbagliarla.

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

| Cosa | Atteso |
|---|---|
| `/` | la pagina iniziale con i due pulsanti |
| `/registrati` | il modulo di registrazione |
| `/organizzazione` senza sessione | rimando a `/accedi` |
| registrazione di un'azienda di prova | crea l'account e porta all'area azienda |

La prima richiesta dopo un periodo di inattività può essere lenta: il piano
gratuito di Neon spegne il database e deve risvegliarlo.

---

## Tre trappole da conoscere

**Il build riesce anche senza nessuna variabile.** Verificato: nascondendo
completamente la configurazione, `next build` completa lo stesso. È comodo, ma
inganna — un deploy verde **non** dimostra che le variabili siano giuste. Se
`DATABASE_URL` manca o è sbagliata, te ne accorgi solo quando qualcuno prova a
registrarsi. Controlla sempre il giro completo, non il colore della spunta.

**Usa la stringa pooled.** Su Neon `DATABASE_URL` deve contenere `-pooler`
nell'host. Quella diretta funziona in locale e crolla in ambiente serverless, dove
ogni invocazione aprirebbe una connessione propria fino a esaurire il limite.

**Vercel Hobby vieta l'uso commerciale.** Legittimo per un proof-of-concept
(ADR-0001). Se il progetto cambiasse natura, cambia anche il piano necessario.

---

## Dopo la messa in linea

Aggiorna [`docs/stato-progetto.md`](stato-progetto.md): la casella «Vercel · deploy»
passa da grigia a verde, e il diagramma del collo di bottiglia perde l'ultimo
riquadro arancione. Il traguardo T0 è dimostrabile solo a quel punto: *«ci si
registra come azienda ed è online»*.
