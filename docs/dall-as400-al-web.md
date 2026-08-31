# Dall'AS/400 al web

Documento di traduzione. A sinistra ciò che il Product Owner conosce da
trent'anni, a destra l'equivalente in questo progetto — con l'avvertenza, ogni
volta che serve, di **dove il paragone si rompe**.

Nasce dalla regola **R6** di `AGENTS.md`: un paragone approssimativo dichiarato
come tale aiuta; un paragone sbagliato spacciato per esatto fa danno.

Cresce man mano che i concetti si incontrano. Se una voce manca, va aggiunta
quando serve, non prima.

---

## 1. Dove vive il codice

| AS/400 | Qui | Dove il paragone si rompe |
|---|---|---|
| Libreria (`*LIB`) | Cartella nel filesystem | Nessuna *library list*: non esiste un ordine di ricerca implicito. Ogni riferimento a un file è esplicito. |
| Source physical file + membro | File di testo | Un membro sorgente vive dentro un oggetto database; qui un file è solo un file su disco. |
| PDM, SEU | VS Code | |
| Oggetto `*PGM` compilato | Non esiste un equivalente permanente | Vedi §3: qui il "compilato" è temporaneo e ricostruibile. |
| `*LIBL` | `import` espliciti | La dipendenza è scritta nel file che la usa, non nell'ambiente in cui gira. |

**La differenza che conta:** su AS/400 il sorgente e l'oggetto compilato
convivono sulla macchina, e l'ambiente decide cosa trovi. Qui esiste **solo il
sorgente** come verità; tutto il resto è generato e buttato via di continuo.

---

## 2. Il controllo di versione: git

Non ha un equivalente diretto su AS/400. Ci si avvicina il **journaling**, ma la
differenza è sostanziale.

| Concetto | Cosa significa |
|---|---|
| **Repository** | L'intero progetto **più tutta la sua storia**, dal primo giorno. Non un archivio di backup: la storia è consultabile e navigabile. |
| **Commit** | Una fotografia coerente di tutti i file, con un messaggio che dice *perché* è cambiato qualcosa. L'unità minima di storia. |
| **Branch** | Una linea di lavoro parallela. Si lavora lì senza toccare la versione buona. Costa quasi nulla crearne uno. |
| **`main`** | Il branch principale: la versione considerata valida. È quella che finisce online. |
| **Merge** | Riportare il lavoro di un branch dentro `main`. |
| **Pull request (PR)** | La richiesta di fare quel merge, con una descrizione e una revisione prima. |
| **Push / pull** | Mandare i propri commit al server condiviso, e prendere quelli altrui. |

**L'analogia con il journaling e dove si rompe:** il journal registra *cosa* è
cambiato in un file, per poterlo rifare o disfare. Git registra *stati completi*
del progetto e **perché**, e permette di lavorare su più versioni in parallelo
per poi ricombinarle. Il journal è uno strumento di recupero; git è uno
strumento di collaborazione.

**Perché tanti branch in questo progetto:** perché `main` deve restare sempre
funzionante — è quello che viene pubblicato. Un errore scritto direttamente lì
andrebbe online immediatamente.

---

## 3. Compilare, e perché qui è diverso

Su AS/400 si compila una volta e l'oggetto `*PGM` resta: è una cosa reale, che
occupa spazio, che si può salvare e ripristinare.

Qui il processo si chiama **build** e produce roba **temporanea**:

| Passaggio | Cosa fa |
|---|---|
| **TypeScript → JavaScript** | I browser capiscono solo JavaScript. TypeScript aggiunge i tipi, che servono a noi e ai controlli, e poi vengono **rimossi**. Si chiama *transpilazione*: da linguaggio a linguaggio, non da linguaggio a codice macchina. |
| **Bundling** | Centinaia di file diventano pochi file grandi, perché ogni file scaricato separatamente è una richiesta di rete in più. |
| **Minificazione** | Nomi accorciati, spazi tolti: il codice diventa illeggibile ma pesa meno. |

Il risultato finisce in una cartella `.next/` che **non viene versionata** e si
può cancellare in qualsiasi momento: si rigenera con `npm run build`.

**Il capovolgimento rispetto all'AS/400:** lì l'oggetto compilato è il
patrimonio, e il sorgente serve a rifarlo. Qui il sorgente è il patrimonio, e il
compilato è materiale di consumo.

---

## 4. Le dipendenze: npm e `node_modules`

Su AS/400 le API di sistema ci sono e basta: fanno parte del sistema operativo.

Qui quasi tutto arriva da **pacchetti** scaricati da un archivio pubblico
(*npm registry*).

| File | Cosa contiene |
|---|---|
| `package.json` | L'elenco di ciò che il progetto **dichiara** di usare, con i vincoli di versione |
| `package-lock.json` | Le versioni **esatte** installate, comprese le dipendenze delle dipendenze |
| `node_modules/` | I pacchetti veri e propri: migliaia di file, **mai versionati** |

Il comando `npm ci` legge il lock e ricostruisce `node_modules/` identica ovunque
— sul tuo PC, sulla macchina di un altro, sul server di build.

**Il rischio che non esiste su AS/400:** stai eseguendo codice scritto da
sconosciuti. Per questo `AGENTS.md` §3 vieta di aggiungere una dipendenza senza
una decisione motivata, e suggerisce di scrivere venti righe proprie in caso di
dubbio.

---

## 4.bis `npm run <qualcosa>`: i comandi del progetto

Questa notazione compare ovunque — in questo documento, nelle guide, nei
messaggi degli agenti — e finora **non era spiegata da nessuna parte**. È il
tipo di omissione che rende una documentazione inutile proprio a chi ne ha più
bisogno.

### Che cos'è

`package.json` ha una sezione `"scripts"`: un **elenco di comandi con un nome
breve**. Per esempio:

```json
"scripts": {
  "verify": "npm run typecheck && npm run lint && npm run test",
  "chiave":  "node scripts/genera-chiave.mjs",
  "libro":   "node scripts/book-progress.mjs"
}
```

`npm run chiave` significa: *«cerca `chiave` in quell'elenco ed esegui ciò che
c'è scritto accanto»*. Niente di più. È una **scorciatoia con un nome
leggibile** al posto di una riga di comando lunga e facile da sbagliare.

### Il ponte con l'AS/400

Il parallelo più vicino è un **membro CLP** che raccoglie una sequenza di
comandi e si lancia per nome. `package.json` è l'elenco di quei membri, e
`npm run` è il `CALL`.

Il paragone però **si ferma prima di quanto sembri**, e vale la pena dire dove:

| AS/400 | Qui |
|---|---|
| il CLP va **compilato** (`CRTCLPGM`) prima di girare | nessuna compilazione: si esegue il testo com'è |
| il comando diventa un **oggetto** nella libreria | resta una riga in un file di testo versionato |
| `DSPOBJD` mostra cosa esiste | l'elenco si legge aprendo `package.json` |

Il fatto che sia un file di testo versionato è la parte che conta: quando
qualcuno aggiunge un comando, arriva a tutti con il prossimo `git pull`. Non
c'è nulla da installare.

### Dove si scrive

Nel **terminale di VS Code**: menù *Terminale → Nuovo terminale*, oppure
`Ctrl+ò`. Si apre un riquadro in basso, e la posizione corrente è già la
cartella del progetto — che è la condizione perché `npm` trovi `package.json`.

È l'equivalente della riga comandi di un'emulazione 5250, con una differenza:
qui non c'è `F4` per chiedere i parametri. Un comando si scrive per intero, e se
sbagli il nome `npm` risponde con l'elenco di quelli che esistono.

### Come si scopre cosa esiste

```powershell
npm run
```

Senza altro. Stampa **tutti** i comandi disponibili con la riga che eseguono. È
il `WRKOBJ` di questo mondo, e conviene lanciarlo ogni tanto: l'elenco cresce.

I principali di questo progetto:

| Comando | Cosa fa |
|---|---|
| `npm run verify` | controlla tipi, stile, test e confini. **Deve passare prima di considerare finito un lavoro** |
| `npm run dev` | avvia l'applicazione sul tuo PC, su `http://localhost:3000` |
| `npm run chiave` | genera una chiave di custodia e la mette negli **appunti** |
| `npm run libro` | quanto del libro *Scrum and XP from the Trenches* è implementato |
| `npm run seed` | carica i dati di esempio |

### Il trattino doppio

Alcuni comandi accettano opzioni, e la notazione è insolita:

```powershell
npm run chiave -- --mostra
```

Il `--` isolato serve a dire a `npm`: *«quello che segue non è per te, passalo
al comando»*. Senza, `npm` proverebbe a interpretare `--mostra` come una propria
opzione e non lo capirebbe.

### Che cosa fa `npm run chiave`

Genera 32 byte casuali, li codifica in base64 — 44 caratteri — e li mette negli
**appunti del sistema**, quelli di `Ctrl+V`.

**Non li stampa a schermo, e non è pignoleria.** Un segreto stampato resta nella
cronologia del terminale, nello scrollback, e — quando alla tastiera c'è un
assistente — nella trascrizione di una conversazione inviata a terzi. Passare
dagli appunti è l'unico modo perché il valore vada dal punto in cui nasce al
punto in cui serve senza lasciare copie.

Il comando conferma **la forma** di ciò che ha generato, così sai che negli
appunti c'è finito qualcosa di sensato:

```
Chiave di custodia generata.
  forma:         44 caratteri base64 = 32 byte
  attesa:        44 caratteri = 32 byte
  negli appunti: sì
```

Poi stampa dove incollarla. Se il valore vuoi vederlo — è tuo, ne hai diritto —
`npm run chiave -- --mostra`.

---

## 5. Il database

| AS/400 | Qui |
|---|---|
| DB2 for i | PostgreSQL (servizio Neon) |
| DDS o SQL DDL | Schema dichiarato in TypeScript con Drizzle |
| `CRTPF` / `ALTER TABLE` eseguiti a mano | **Migrazioni**: file SQL numerati e versionati |
| Commitment control | Transazioni |
| Journaling | Write-ahead log (interno, non lo tocchiamo) |

**Le migrazioni sono il concetto nuovo.** Ogni modifica allo schema diventa un
file numerato, salvato nel repository accanto al codice. Il database tiene il
conto di quali ha già applicato.

Perché conta: chiunque, ovunque, parte da un database vuoto e arriva alla stessa
struttura eseguendo gli stessi file nello stesso ordine. Non esiste il momento
"ho modificato la tabella in produzione e non me lo ricordo".

Il DDS descrive **com'è** un file; una migrazione descrive **come ci si arriva**.

---

## 6. Dove gira l'applicazione

Su AS/400 il programma gira sulla macchina, e la macchina è lì.

Qui l'applicazione gira su **Vercel**, in modalità *serverless*: non esiste un
processo sempre acceso. Arriva una richiesta, viene avviato qualcosa, risponde,
e sparisce.

Conseguenze concrete, non teoriche:

- **Niente stato in memoria fra due richieste.** Una variabile globale non
  sopravvive: la richiesta successiva potrebbe essere servita da un'altra
  macchina.
- **Le connessioni al database vanno gestite diversamente.** Da qui la
  distinzione fra stringa *pooled* e *diretta* in `.env.local`.
- **Il primo accesso dopo una pausa è lento.** Il piano gratuito di Neon spegne
  il database e deve riaccenderlo (*cold start*).

Non c'è un equivalente su AS/400: è un modello di esecuzione diverso, non una
variante dello stesso.

---

## 7. La configurazione: variabili d'ambiente

Su AS/400 la configurazione sta in data area, file di configurazione, variabili
d'ambiente di sistema.

Qui sta nelle **variabili d'ambiente**: coppie nome/valore che il programma legge
all'avvio.

| Dove | Cosa |
|---|---|
| `.env.local` | Sul tuo PC. **Mai versionato**: contiene password vere. |
| `.env.example` | Versionato. Contiene i **nomi** delle variabili, mai i valori. |
| Pannello Vercel | I valori di produzione |

**La regola che non ha equivalente:** un segreto non entra mai nel repository.
Una volta dentro, resta nella storia per sempre — e la storia è pubblica se il
repository lo è.

---

## 8. I test

Su AS/400 si prova il programma in un ambiente di collaudo, spesso a mano.

Qui i test sono **codice che verifica altro codice**, eseguibile in qualsiasi
momento, su tre livelli:

| Livello | Cosa verifica | Quanto ci mette |
|---|---|---|
| **Unitari** (Vitest) | Una funzione alla volta, senza database né rete | secondi |
| **Integrazione** | Il codice contro un database vero | qualche secondo |
| **End-to-end** (Playwright) | Un browser vero che clicca sull'applicazione vera | un paio di minuti |

`npm run verify` esegue i primi e, insieme a loro, controlla i tipi e le regole
di stile. È il cancello: finché non passa, il lavoro non è finito (regola R5).

**Perché sono scritti come codice e non fatti a mano:** perché una prova manuale
verifica il momento in cui la fai, mentre un test scritto verifica **ogni volta**,
per sempre, anche fra sei mesi quando nessuno ricorda più che quel caso limite
esisteva.

---

## 9. Il ciclo completo, dal codice al sito

```mermaid
graph LR
    A["1 · scrivo<br/>sul mio PC"] --> B["2 · npm run verify<br/>controlla tutto"]
    B --> C["3 · commit<br/>fotografia"]
    C --> D["4 · push<br/>su un branch"]
    D --> E["5 · pull request"]
    E --> F["6 · la CI rifà<br/>i controlli"]
    F --> G["7 · merge<br/>in main"]
    G --> H["8 · Vercel pubblica<br/>da solo"]
```

I passi 6 e 8 sono automatici: nessuno li avvia.

**Cosa non esiste su AS/400:** il passo 8. Non c'è un momento in cui "si mette in
produzione" con un comando. Il sistema osserva il repository e, quando `main`
cambia, ricostruisce e pubblica. Il merge *è* la messa in produzione.

---

## 10. Parole che ricorrono

| Parola | Significato qui |
|---|---|
| **Runtime** | L'ambiente che esegue il codice. Node.js sul server, il motore JavaScript nel browser. |
| **Framework** | Impalcatura che impone una struttura e fornisce le parti comuni. Qui: Next.js. |
| **Serverless** | Codice eseguito su richiesta, senza un processo permanente. |
| **Endpoint** | Un indirizzo che risponde a una richiesta. Vagamente: un programma richiamabile dall'esterno. |
| **Deploy** | Pubblicare una versione. |
| **Rollback** | Tornare a una versione precedente. Su Vercel: due click, il vecchio deploy è ancora lì. |
| **Hot reload** | Durante lo sviluppo, la pagina si aggiorna da sola appena salvi. |
| **Linting** | Controllo automatico dello stile e degli errori tipici, prima ancora di eseguire. |
| **Type checking** | Verifica che i tipi siano coerenti. Avviene prima dell'esecuzione, come una compilazione, ma non produce niente. |
| **CI** | *Continuous Integration*: un server che rifà i controlli a ogni modifica, per non fidarsi del PC di chi ha scritto. |

---

## 11. Due errori che il compilatore non ha visto

Il 21 agosto 2026 la dashboard è stata guardata in un browser per la prima volta.
`npm run verify` era verde, 358 test passavano, la CI era verde, il deploy
riusciva. Due difetti erano comunque lì. Vale la pena capirli, perché
appartengono a una categoria che sull'AS/400 quasi non esiste.

### Il primo: la stima che non arrivava mai nel database

Il generatore di dati produceva una stima per ogni elemento. Il database aveva
due colonne, `estimate_value` e `estimate_unit`. Nel database erano nulle tutte
e cinquantuno. La dashboard scriveva, onestamente, «nessuna stima» per quattro
sprint.

Lo script di caricamento passava all'ORM l'oggetto canonico così com'era. Quello
ha una proprietà `estimate` che contiene *due* valori insieme; la tabella ha due
colonne separate. L'ORM non conosceva `estimate`, l'ha ignorata, e ha scritto
NULL nelle due colonne — **senza un errore, senza un avviso**.

Perché TypeScript non l'ha visto? Per una regola che sorprende: il controllo
sulle proprietà in eccesso scatta solo sui *letterali* scritti a mano, non su una
variabile. E le due colonne, essendo annullabili, erano facoltative: ometterle
non è un errore. Il tipo diceva il vero, e il vero non bastava.

C'era anche un `as never` nel codice, messo per far compilare un ciclo. È il
modo di dire al compilatore «fidati». Il compilatore si è fidato.

**Il rimedio non è stare più attenti.** È una funzione di conversione che scrive
la riga come letterale, campo per campo, con un tipo che rende *obbligatoria*
ogni colonna. Adesso dimenticarne una non compila. Più un test che rifà il giro
completo — canonico → riga → canonico — su tutti e cinquantuno gli elementi.

**Il ponte con l'AS/400:** in RPG, con un file descritto esternamente, la
struttura del record *è* il tracciato. Non esiste lo scarto fra «l'oggetto in
memoria» e «la riga su disco», perché sono la stessa cosa. Qui sono due modelli
distinti e qualcuno deve tradurre. Se quel qualcuno sbaglia in silenzio, i dati
sono sbagliati e tutto continua a funzionare.

### Il secondo: le etichette del grafico che il server non scriveva

Nel grafico burndown, l'etichetta di ogni punto era scritta così:

```jsx
<title>{data}: {valore} {unità}</title>
```

Sembra una frase. Per React sono **cinque pezzi separati**. E React 19 tratta
`<title>` come un elemento speciale che accetta un solo pezzo di testo: davanti a
cinque non ne scrive nessuno. Il server mandava `<title></title>`, vuoto. Le
etichette comparivano solo dopo che il JavaScript aveva ricostruito la pagina nel
browser.

Conseguenze: chi legge la pagina con un lettore di schermo, o prima che il
JavaScript sia caricato, non vedeva nulla. E a ogni caricamento il browser
segnalava un *hydration mismatch* — il server e il browser avevano prodotto due
pagine diverse.

React lo diceva. Stampava un messaggio esplicito, con perfino il suggerimento di
usare una stringa unica. Nessuno aveva mai aperto la console del browser.

**Il rimedio:** costruire prima la stringa, poi passarla come pezzo unico. Più un
test che rende la pagina sul server e verifica che l'etichetta sia scritta
*nell'HTML*, non nel browser.

**Il ponte con l'AS/400:** un programma 5250 rende lo schermo una volta sola, sul
sistema. Qui la stessa pagina viene costruita **due volte**: prima sul server per
mandarla subito, poi nel browser per renderla interattiva. Se le due versioni non
coincidono, il browser butta via la prima. È un concetto che non ha equivalente
sul verde, e produce una classe di errori tutta sua.

### La lezione comune

Nessuno dei due difetti era visibile dai test, dal compilatore o dal deploy
riuscito. Entrambi si sono visti in tre minuti aprendo la pagina e guardando i
numeri e la console.

> Verde non vuol dire giusto. Vuol dire che nessuno dei controlli che abbiamo
> scritto ha protestato. Guardare il risultato resta un passo, non un lusso.

---

Quando incontri un concetto che non conosci, chiedilo: la spiegazione entra qui.
Il documento serve a te, quindi cresce sulle tue domande — non su ciò che un
agente immagina tu debba sapere.
