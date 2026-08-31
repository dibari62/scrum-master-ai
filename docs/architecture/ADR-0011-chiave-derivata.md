# ADR-0011 — La chiave di custodia si può derivare da `AUTH_SECRET`

- **Stato:** accettato
- **Data:** 2026-08-31
- **Decisori:** Giuseppe Di Bari

## Contesto

[ADR-0010](ADR-0010-chiavi-del-cliente.md) ha stabilito che le credenziali dei
progetti — token Jira, chiavi dei modelli — sono cifrate prima di toccare il
database, con una chiave a 32 byte che vive nelle variabili d'ambiente:
`SECRETS_KEY`.

Sull'installazione di produzione **quella variabile non arriva al processo**.

Il fatto è misurato, non supposto. `/organizzazione/ambiente` chiede la stessa
variabile in quattro forme — letterale, oggetto, `globalThis`, nome composto a
runtime — e le confronta con `AUTH_SECRET`, che sappiamo funzionare:

```
SECRETS_KEY                    AUTH_SECRET
  letterale:      no             letterale:      sì
  oggetto:        no             oggetto:        sì
  globalThis:     no             globalThis:     sì
  nome composto:  no             nome composto:  sì
```

Nessuna forma la trova. `Object.keys(process.env)` elenca il nome, quindi la
piattaforma dichiara la variabile e non ne consegna il contenuto.

**Tre giorni di diagnosi, cinque ipotesi cadute** (progetto Vercel sbagliato,
inlining del bundler in due varianti, ambiente sbagliato, valore mai salvato).
Il portale è rimasto inutilizzabile per tutto il tempo: senza chiave di custodia
rifiuta di conservare credenziali, quindi lo Scrum Master AI non può essere
collegato ad alcun modello.

La causa esatta resta ignota e potrebbe essere del fornitore. **Continuare a
cercarla mentre il prodotto è fermo non è una scelta difendibile.**

## Decisione

Quando `SECRETS_KEY` non è disponibile, la chiave di custodia si **deriva da
`AUTH_SECRET`** con HKDF-SHA256 e un `info` distinto.

```
chiave = HKDF-SHA256(
  ikm  = AUTH_SECRET,
  salt = "scrum-master-ai/secrets/v1",
  info = "custodia-credenziali-progetto",
  len  = 32
)
```

`SECRETS_KEY` resta la fonte **preferita**: se c'è ed è valida, vince.

## Perché è legittimo, e non un ripiego

ADR-0010 vieta esplicitamente il **ripiego sul chiaro**: senza chiave, il modulo
si rifiuta di lavorare. Quel divieto resta intatto — non si scrive nulla in
chiaro, mai.

Derivare una chiave da un segreto ad alta entropia è invece la pratica standard
per ottenere più chiavi indipendenti da un unico materiale, ed è esattamente ciò
per cui HKDF esiste (RFC 5869). Le proprietà che contano:

- **`AUTH_SECRET` ha l'entropia giusta.** È generato come 32 byte casuali dallo
  stesso script che genera `SECRETS_KEY`. Non è una passphrase stirata a forza —
  che è il caso che ADR-0010 rifiuta, e continua a rifiutare.
- **L'`info` distinto rende le due chiavi indipendenti.** Conoscere la chiave di
  sessione non aiuta a ricavare quella di custodia, e viceversa: è la garanzia
  che HKDF fornisce.
- **Nessun segreto in più esce dal sistema.** Chi ottiene `AUTH_SECRET` poteva
  già falsificare le sessioni di chiunque, cioè entrare come proprietario e
  leggere i progetti dall'interfaccia. La derivazione non allarga la superficie
  di attacco in modo significativo.

## Il prezzo, dichiarato

**Ruotare `AUTH_SECRET` rende illeggibili le credenziali cifrate.**

È il costo vero di questa decisione. `AUTH_SECRET` si ruota per invalidare le
sessioni — un'operazione legittima e occasionalmente necessaria — e chi la
esegue si aspetta di far uscire tutti, non di perdere le chiavi dei progetti.

Le mitigazioni:

- la pagina `/organizzazione/ambiente` **dichiara quale fonte è in uso**, quindi
  la dipendenza non è nascosta;
- il messaggio che accompagna una decifratura fallita rimanda qui;
- le credenziali non sono irrecuperabili in senso assoluto: si reinseriscono,
  una per progetto.

Impostare `SECRETS_KEY` resta la configurazione preferibile, e toglie il
problema.

## Alternative scartate

**Aspettare la risposta del fornitore.** Tempi ignoti, prodotto fermo. Si può
fare *in parallelo*, non *invece*.

**Chiedere la chiave all'utente a ogni avvio.** Su una piattaforma serverless
non esiste un «avvio» a cui appoggiarsi, e la chiave dovrebbe vivere da qualche
parte comunque.

**Conservare le credenziali in chiaro.** Vietato da ADR-0010, e giustamente: il
database non è un luogo chiuso — backup del fornitore, query di supporto,
`npm run db:inspect`.

**Derivare da `DATABASE_URL`.** È l'altra variabile che arriva, ma è una
stringa di connessione: entropia bassa e struttura nota, quindi non è materiale
crittografico. `AUTH_SECRET` è casuale per costruzione.

## Conseguenze

- Il portale funziona su un'installazione dove `SECRETS_KEY` non arriva.
- Chi ruota `AUTH_SECRET` deve sapere cosa comporta: la pagina lo dice.
- Resta aperta la domanda su perché quella variabile non venga consegnata. Il
  fatto è documentato in `ripartire-da-zero.md` §5.quinquies con la misura che
  lo prova, ed è materiale sufficiente per un ticket al fornitore.
