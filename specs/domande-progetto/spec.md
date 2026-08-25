# Domande sul progetto

## 1. Il problema

Chi segue un progetto ha domande che nessuna dashboard anticipa: «a che punto è la
spedizione?», «cos'è successo al pagamento con carta?», «ci sono cose bloccate sul
carrello?». Oggi la risposta si ottiene aprendo l'elenco degli elementi e
leggendo, che è esattamente il lavoro che uno Scrum Master fa per gli altri.

**Il rischio specifico di questa capacità** è diverso da quello delle altre. Un
resoconto sbagliato cita un numero che si può confrontare con la dashboard; una
risposta libera sbagliata non ha niente accanto a sé. Per questo la risposta non
è utile se non è **verificabile**: deve dire su quali elementi si basa, e quegli
elementi devono essere apribili.

## 2. Chi legge

Chi ha una domanda su un progetto e non sa da quale schermata cominciare.

## 3. Portata

**Incluso**

- Una domanda in testo libero, posta dalla pagina degli elementi del progetto.
- Un **pre-filtro deterministico** che sceglie in codice gli elementi rilevanti.
- Una risposta che cita le fonti usate, ognuna apribile.
- Il rifiuto quando la risposta cita fonti che non le sono state date.

**Escluso** *(sezione obbligatoria)*

- **Gli embeddings e la ricerca vettoriale**, per questo incremento. Vedi Q1.
- La memoria della conversazione: ogni domanda sta in piedi da sola. Una catena
  di domande introduce il problema di che cosa il modello «ricordi», che è una
  decisione separata.
- Le domande sulle persone («chi ha fatto cosa»): §8.2 vieta le metriche
  individuali, e una domanda libera è il modo più facile per aggirarle.
- Le azioni: la capacità risponde, non scrive nulla da nessuna parte (R3).

## 4. Comportamento

1. Il lettore scrive una domanda.
2. Il codice sceglie gli elementi rilevanti confrontando i termini della domanda
   con titolo e descrizione, e ne passa **al massimo venti**.
3. Se nessun elemento è rilevante, **il codice risponde da sé** che non lo sa, e
   non chiama alcun modello: pagare per farsi dire «non lo so» è spreco, e un
   modello a cui non si danno fonti ne inventa.
4. Il modello riceve le fonti numerate e risponde citandone gli indici.
5. La risposta è validata, verificata e mostrata — oppure rifiutata e spiegata.

## 5. Criteri di accettazione

1. Ogni fonte citata è una di quelle fornite: un indice fuori elenco è un
   riferimento a nulla, e la risposta viene rifiutata.
2. Una risposta senza alcuna citazione è rifiutata, **tranne** quando dichiara di
   non sapere: è l'unica risposta che legittimamente non poggia su niente.
3. I titoli e le descrizioni degli elementi viaggiano come **dati non fidati**
   (§8.1): una descrizione che contiene «ignora le istruzioni» resta testo da
   leggere.
4. La domanda dell'utente è anch'essa dato: non può cambiare le regole del
   sistema.
5. Nessuna risposta nomina persone o attribuisce lavoro a qualcuno.
6. Le fonti citate sono mostrate con un collegamento all'elemento.

## 6. Vincoli di `AGENTS.md`

- [x] **R1** — nessun numero calcolato dal modello; se una domanda richiede una
      metrica, la risposta rimanda alla schermata che la calcola.
- [x] **R2** — si legge il modello canonico, mai un formato esterno.
- [x] **R3** — nessuno strumento scrivente è esposto; la risposta è solo testo.
- [x] **R4** — output vincolato da uno schema Zod in `src/domain`.
- [x] **§8.1** — domanda e contenuti ingeriti sono entrambi dati delimitati.
- [x] **§9** — pre-filtro deterministico obbligatorio: al modello arrivano al
      massimo venti elementi scelti dal codice, non l'intero progetto.

## 7. Questioni aperte

- **Q1 — Ricerca per termini o per significato.** Questo incremento sceglie il
  confronto **per termini**, in codice. Le ragioni, in ordine di peso:

  1. **Funziona senza un fornitore.** Gli embeddings richiedono una chiave e una
     chiamata a pagamento *anche solo per cercare*. Su questo ambiente non c'è
     alcun fornitore configurato, e una capacità che non parte non si può
     valutare.
  2. **La selezione resta ispezionabile.** Con i termini si può dire perché un
     elemento è stato scelto; con un vettore la risposta è «era vicino», e la
     parte più delicata — quali fonti sono finite sotto gli occhi del modello —
     diventa opaca.
  3. Il costo di sbagliarsi è basso: se la ricerca per termini si rivelerà
     povera, `pgvector` è già nello stack e il pre-filtro è un modulo solo.

  Il limite è reale e va detto: chi chiede «problemi con il pagamento» non trova
  un elemento intitolato «errore nel checkout con carta» se non condivide alcuna
  parola. Da rivedere su dati veri, con un ADR se si passa ai vettori.

- **Q2 — Quante fonti.** Venti, scelte per copertura e non per punteggio puro.
  Non tarato su dati veri.
