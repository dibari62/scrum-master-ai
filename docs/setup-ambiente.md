# Preparazione dell'ambiente di sviluppo

Cosa serve per far girare il progetto in locale, e come ottenerlo.
Questo file non contiene **nessun valore**: solo i nomi delle variabili e la procedura.

---

## 1. Servizi esterni

Sei servizi, tutti su piano gratuito, nessuno richiede una carta di credito.

| Servizio | Piano | A cosa serve | Serve dal traguardo | Variabili prodotte |
|---|---|---|---|---|
| [GitHub](https://github.com) | Free | repository, CI, accesso OAuth | T0 | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` |
| [Neon](https://neon.tech) | Free | Postgres + pgvector | T0 | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` |
| [Vercel](https://vercel.com) | Hobby | hosting | T0 | — |
| [Google AI Studio](https://aistudio.google.com/apikey) | Free | Gemini, provider primario | T3 | `GEMINI_API_KEY` |
| [Groq](https://console.groq.com/keys) | Free | provider di riserva | T3 | `GROQ_API_KEY` |
| [Upstash](https://console.upstash.com/qstash) | Free | QStash, job schedulati | T5 | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` |

Vercel Hobby vieta l'uso commerciale: legittimo per un proof-of-concept (ADR-0001).
Il piano gratuito di Gemini usa i contenuti inviati per migliorare i propri prodotti,
quindi **solo dati sintetici** possono transitare dal modello (ADR-0005).

---

## 2. Neon: due stringhe di connessione, non una

Neon espone lo stesso database su due endpoint **non intercambiabili**.

| Variabile | Host | Chi la usa |
|---|---|---|
| `DATABASE_URL` | contiene `-pooler` | l'applicazione |
| `DATABASE_URL_UNPOOLED` | senza `-pooler` | le migrazioni |

L'endpoint con pooling fa girare PgBouncer in *transaction mode*: la connessione torna
nel gruppo al termine di ogni transazione, quindi `SET`, tabelle temporanee, `PREPARE` e
i lock di sessione non sopravvivono. Gli strumenti di migrazione si appoggiano proprio a
quelli. L'applicazione ha invece bisogno del pooling, perché in ambiente serverless ogni
invocazione aprirebbe una connessione propria fino a esaurire `max_connections`.

Le due stringhe differiscono **solo** per il suffisso `-pooler`:

```
postgresql://UTENTE:PASSWORD@ep-xxxx-pooler.REGIONE.aws.neon.tech/neondb?sslmode=require
postgresql://UTENTE:PASSWORD@ep-xxxx.REGIONE.aws.neon.tech/neondb?sslmode=require
```

Copia la connection string completa dalla console (**Connect** → interruttore
*Connection pooling*): il campo *Host* da solo non include il prefisso `postgresql://`.

Abilita infine pgvector una volta sola, dall'SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## 3. GitHub: due applicazioni OAuth

Un'applicazione OAuth di GitHub accetta **un solo** URL di ritorno, quindi ne servono due.

| | Sviluppo | Produzione |
|---|---|---|
| Homepage | `http://localhost:3000` | l'URL Vercel del progetto |
| Callback | `http://localhost:3000/api/auth/callback/github` | `<URL Vercel>/api/auth/callback/github` |

Il percorso `/api/auth/callback/github` è quello che Auth.js si aspetta: deve coincidere
esattamente. In `.env.local` vanno le credenziali dell'applicazione di **sviluppo**;
quelle di produzione vivono nelle variabili d'ambiente di Vercel.

Il *client secret* si vede una volta sola, al momento della generazione.

---

## 4. Comporre `.env.local`

```bash
cp .env.example .env.local     # su Windows: Copy-Item .env.example .env.local
node scripts/generate-secrets.mjs
```

Lo script riempie `AUTH_SECRET` e `JOB_SECRET` con valori casuali **scrivendoli
direttamente nel file**: un segreto stampato a terminale finisce nella cronologia della
shell e, se il comando lo esegue un agente, nella trascrizione di una conversazione.
I valori già presenti non vengono toccati.

Le altre variabili si compilano a mano con quanto raccolto ai punti precedenti.
`LLM_PROVIDER` resta `fake`: in sviluppo e nei test non parte alcuna chiamata reale
(`AGENTS.md` §9).

`.env.local` è escluso da git. Non va mai incollato in una chat, in un ticket o in una
pull request.

---

## 5. Verifica

```bash
node scripts/check-env.mjs
```

Controlla che le variabili obbligatorie siano valorizzate, che le due stringhe Neon
abbiano la forma giusta, e **si collega davvero al database** verificando anche che
pgvector sia attivo. Non stampa mai un valore: solo nomi, lunghezze ed esiti.

---

## 6. Rete aziendale che ispeziona il traffico HTTPS

Su una macchina aziendale il traffico HTTPS può essere intercettato da un proxy che
sostituisce i certificati (qui: **Cisco Umbrella**). Windows si fida dell'autorità
aziendale, ma **Node.js usa una propria lista** e non la conosce: ogni connessione in
uscita fallisce con

```
unable to get local issuer certificate
```

Non è un problema di configurazione dell'applicazione, e si manifesta ovunque: verifica
dell'ambiente, migrazioni, chiamate ai modelli.

**Soluzione.** Individua l'autorità che firma davvero, ispezionando la catena presentata
dal server — non dare per scontato che sia quella dell'azienda:

```bash
node -e "const t=require('node:tls');const s=t.connect({host:'HOST',port:443,rejectUnauthorized:false},()=>{let c=s.getPeerCertificate(true);while(c){console.log(c.issuer);if(c.issuerCertificate===c)break;c=c.issuerCertificate}s.end()})"
```

Esportala dall'archivio certificati di Windows e convertila in PEM:

```powershell
Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'NOME' }
certutil -store Root <THUMBPRINT> ca.cer
certutil -encode ca.cer ca.pem
```

Indica a Node il file, una volta per tutte:

```powershell
setx NODE_EXTRA_CA_CERTS "$env:USERPROFILE\corporate-ca.pem"
```

Il file PEM **non va versionato**: `.gitignore` esclude `*.pem`, `*.cer` e `certs/`.
Rivela dettagli dell'infrastruttura di rete e non serve a chi lavora da un'altra rete.

---

## 7. Vincoli della macchina di sviluppo

- **PowerShell in *constrained language mode*** con esecuzione di script disabilitata:
  gli shim `node_modules\.bin\*.cmd` sono bloccati da criteri di gruppo. Per questo gli
  script di `package.json` invocano i punti di ingresso Node (`node
  node_modules/typescript/bin/tsc`), forma che funziona identica su Windows e su Linux.
- I comandi `npm` si eseguono tramite `cmd.exe`:
  `& $env:ComSpec /c "cd /d C:\percorso && npm run verify"`.
- Il repository deve stare **fuori da OneDrive**: la sincronizzazione di `node_modules`
  rende l'installazione lentissima e soggetta a file bloccati.
