# ADR-0010 — La chiave del modello la porta il cliente, e noi dobbiamo custodirla

- **Stato:** proposto
- **Data:** 2026-08-27
- **Decisori:** Product Owner

## Contesto

Oggi il modello linguistico è **uno solo per tutta l'applicazione**: `LLM_PROVIDER`
e `GEMINI_API_KEY` stanno nelle variabili d'ambiente della piattaforma, e il
gateway in `src/lib/llm` le legge da lì (ADR-0005). Va bene per una dimostrazione
con un solo progetto e un solo utilizzatore. Non regge appena i progetti sono di
aziende diverse.

Il Product Owner ha deciso: **la chiave la porta chi usa il portale**. Ogni
progetto dichiara il proprio fornitore, il proprio modello e la propria chiave.

La motivazione è economica e strategica insieme, ed entrambe reggono:

- **Costo zero per noi.** Un portale che chiama un modello per conto di cento
  progetti paga per cento progetti. Un PoC non può, e un prodotto che lo facesse
  dovrebbe far pagare abbastanza da coprirlo prima ancora di avere un cliente.
- **Nessun legame con un fornitore.** Se domani Gemini triplica il prezzo, o
  chiude il piano gratuito, o cambia le condizioni d'uso, il problema è di chi ha
  la chiave. Noi restiamo neutrali, ed è la posizione giusta per uno strumento che
  deve durare più a lungo del fornitore di turno.

Ma la decisione **crea un problema che prima non avevamo**.

## Il problema che la decisione crea

Una chiave API di un modello — e allo stesso modo un token Jira — è **un segreto
di qualcun altro** che finisce nel **nostro** database.

Non è un dettaglio di implementazione. Chi ottiene quella chiave:

- può spendere i soldi di quel cliente, fino al limite del suo piano;
- può leggere, con il token Jira, tutto ciò che quel token vede — che in
  un'azienda è quasi tutto.

E il database non è un luogo chiuso. Ci passano attraverso: i backup automatici di
Neon, le query di supporto scritte a mano, i log di un errore che stampa una riga,
`npm run db:inspect`, e chiunque abbia accesso alla console del fornitore.

> **Il paragone con l'AS/400, e dove si rompe.** In DB2/400 non si scrive mai una
> password in chiaro in un campo: chi ha `*ALLOBJ` legge tutto, e lo sanno tutti.
> Lì la difesa era spesso *l'autorizzazione a livello di oggetto* — nessuno
> arrivava alla tabella. Qui quella difesa **non esiste**: il database è un
> servizio a cui si accede da Internet con una stringa di connessione, e la
> stringa di connessione è essa stessa un segreto che è già finito una volta in
> chiaro (è nel debito registrato). Sull'AS/400 il perimetro era la macchina.
> Qui il perimetro è la riga.

Conservare quelle chiavi in chiaro sarebbe quindi una scelta, non una svista. E
sarebbe la scelta sbagliata.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **A. Chiave in chiaro nel database** | nessun lavoro | un backup, un log o una query di supporto espongono la chiave di un cliente. Inaccettabile anche in un PoC |
| **B. Cifratura a riposo con chiave master nell'ambiente** | il database da solo non basta più: servono **due** cose per leggere un segreto | la chiave master è un punto singolo; va ruotata, e ruotarla richiede di riscrivere le righe |
| **C. Un servizio di gestione segreti (Vault, KMS)** | la pratica corretta su scala | una dipendenza e un costo che un PoC su piano gratuito non sostiene, e un fornitore in più da spiegare |
| **D. Non conservarla: chiederla a ogni esecuzione** | nessun segreto a riposo | i job schedulati sono il punto del prodotto, e girano quando non c'è nessuno a digitare |

## Decisione

**Opzione B.** Ogni segreto di terzi — chiave del modello, token Jira — è cifrato
prima di toccare il database, con **AES-256-GCM** e una chiave master che vive
solo nelle variabili d'ambiente (`SECRETS_KEY`).

Conseguenze precise, tutte vincolanti:

1. **Nessuna colonna contiene un segreto in chiaro.** Il tipo che li rappresenta è
   distinto da `string`, così una riga che ne scrivesse uno grezzo non compila.
2. **Un segreto non torna mai indietro verso il browser.** La schermata mostra se
   una chiave c'è, quando è stata inserita e le sue ultime quattro cifre. Non la
   chiave. Un campo precompilato con il segreto sarebbe la stessa fuga, fatta in
   HTML.
3. **`AES-GCM` e non `AES-CBC`.** GCM autentica: un testo cifrato modificato viene
   *rifiutato*, non decifrato in spazzatura. Senza autenticazione, chi può
   scrivere sul database può alterare una chiave senza che nessuno se ne accorga
   finché non fallisce una chiamata.
4. **Ogni cifratura ha il proprio vettore di inizializzazione casuale.** Riusarlo
   in GCM non indebolisce il testo: **rompe la cifratura**, e con due messaggi
   sotto lo stesso IV la chiave di autenticazione si ricava.
5. **Senza `SECRETS_KEY` l'applicazione non cifra e lo dice.** Non ripiega sul
   chiaro. Un ripiego silenzioso è come non aver preso questa decisione, con in
   più la convinzione di averla presa.

## Motivazione

**Perché non il chiaro, anche in un PoC.** §8.2 dice che il modello dati nasce
corretto perché rifarlo dopo costa dieci volte tanto. Vale ancora di più qui: una
chiave finita in un backup non si «sistema dopo», si **revoca**, e nel frattempo
qualcuno ha speso i soldi di qualcun altro.

**Perché non un gestore di segreti.** Sarebbe la risposta giusta su scala, e la
risposta sbagliata oggi: aggiunge un fornitore, un costo e un concetto nuovo da
spiegare, per proteggere dati sintetici. La condizione per riconsiderare è scritta
sotto, ed è verificabile.

**Perché la chiave master nell'ambiente e non nel codice.** Ovvio, ed è §8.3. Va
detto lo stesso il rovescio: chi ottiene **sia** il database **sia** le variabili
d'ambiente ottiene tutto. La cifratura non rende sicuro un sistema compromesso —
alza il costo di una compromissione *parziale*, che è la forma in cui le
compromissioni avvengono quasi sempre.

## Conseguenze

**Positive**

- Il portale può essere usato da un'azienda senza che noi paghiamo il suo consumo.
- La configurazione del modello smette di essere globale e diventa **per
  progetto**, che è la forma che il prodotto aveva bisogno di avere comunque:
  progetti diversi possono volere modelli diversi.
- Un errore del fornitore diventa raccontabile a chi può risolverlo: «la tua
  chiave è stata rifiutata» invece di «errore interno».

**Negative / costi accettati**

- **La rotazione di `SECRETS_KEY` richiede di riscrivere ogni riga cifrata.** Non
  esiste ancora uno strumento che lo faccia. Va registrato come debito, non
  scoperto il giorno in cui servirà.
- Un segreto cifrato non è cercabile né confrontabile con una `WHERE`. Non ci
  serve, ed è bene saperlo prima di progettarci sopra.
- L'utilizzatore deve procurarsi una chiave prima che lo Scrum Master AI dica una
  parola. È attrito reale sul primo utilizzo, e la schermata deve accompagnarlo
  invece di limitarsi a rifiutare.

**Vincoli che ne derivano per il codice**

- Il modulo di cifratura sta in `src/lib/secrets` ed è l'unico posto che conosce
  l'algoritmo. Nessuna pagina, azione o connettore cifra da sé.
- Il gateway LLM accetta **credenziali passate come argomento**, e continua a
  leggere l'ambiente solo come ripiego per lo sviluppo locale.
- Il connettore Jira riceve le proprie credenziali allo stesso modo: le legge già
  come argomento (`JiraCredentials`), quindi non cambia.
- Nessun segreto compare in un log, in un messaggio d'errore o in una risposta
  HTTP. Esiste un test che lo verifica.

## Quando riconsiderare

- **Se il portale conserva chiavi di più di una manciata di aziende**: a quel
  punto un gestore di segreti gestito (KMS) smette di essere over-engineering e
  diventa il minimo, perché la rotazione manuale non è più praticabile.
- **Se serve la rotazione di `SECRETS_KEY`**: va scritto lo strumento che
  ricifra, e va scritto *prima* di averne bisogno.
- **Se un fornitore offrisse credenziali delegate** (un OAuth verso il modello,
  con permessi limitati e revocabili dal cliente): sarebbe meglio di una chiave
  copiata e incollata, perché il cliente potrebbe togliercela senza chiedercelo.
