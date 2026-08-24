# Narrazione della salute dello sprint

> Secondo incremento di [`sprint-health`](../sprint-health/spec.md), che aveva
> lasciato la narrazione esplicitamente **fuori portata**: «il colore e il motivo
> esistono anche senza modello».

## 1. Il problema

La dashboard mostra già un verdetto e cinque segnali, ognuno con una frase scritta
dal codice. Quindi la domanda giusta non è «serve una narrazione?» ma **che cosa
resta da dire, dopo che il codice ha già detto tutto quello che sa dire.**

Restano tre cose, e sono le uniche che giustificano questo incremento:

1. **Il legame fra i segnali.** Il codice li produce e li mostra *uno per uno*,
   perché sono calcolati uno per uno. Un lettore vede «avanzamento sotto passo» e
   «attesa in revisione oltre l'abitudine» come due fatti separati, e deve
   metterli in relazione da sé: che il lavoro non sia fermo all'inizio ma alla
   fine è una lettura, non una misura.
2. **L'andamento.** I controlli schedulati salvano un verdetto al giorno, e la
   dashboard li disegna come una fila di pallini colorati. «Critico da tre giorni,
   e prima era sereno» è un'informazione diversa da «critico», ma oggi il lettore
   la deve ricostruire contando i pallini.
3. **Il destinatario esterno.** Le frasi del codice usano il gergo del team
   («soglia», «impegno iniziale», «85° percentile»). Chi legge da fuori ha bisogno
   della stessa sostanza senza quel gergo.

**Ciò che *non* è un problema, e va detto perché è la tentazione principale:** non
serve una versione più elegante delle frasi che il codice già scrive. Riscriverle
con un modello linguistico costa denaro e introduce il rischio di sbagliarle, in
cambio di nulla.

## 2. Chi legge

Chi apre la dashboard del progetto e vede un verdetto che non è «Sereno», e vuole
capire *che cosa stia succedendo* prima di portarlo in una riunione.

## 3. Portata

**Incluso**

- Una narrazione generata su richiesta, sotto il semaforo, che collega i segnali
  fra loro, dichiara l'andamento rispetto ai controlli precedenti e resta
  leggibile a chi non è del team.
- La registrazione dell'esecuzione in `skill_runs`, come per `sprint-report`:
  costo, provider, esito, causa del rifiuto.
- L'abilitazione della capacità `sprint-health` sulla scheda dell'agente.

**Escluso** *(sezione obbligatoria)*

- **La persistenza del testo.** La narrazione descrive lo stato di *adesso*:
  conservarla produrrebbe, entro un giorno, un testo che descrive con sicurezza
  una situazione non più vera. Il verdetto è già conservato — quello è un fatto
  datato, questa è la sua lettura.
- **Il calcolo di qualunque cifra da parte del modello.** Vale R1 senza sconti: i
  numeri arrivano già scritti.
- **Consigli su cosa fare.** La persona dell'agente è «osserva, non consiglia».
  Un modello che suggerisce interventi organizzativi su cinque numeri sta
  indovinando.
- **La generazione automatica insieme al controllo schedulato.** Il controllo gira
  ogni giorno su ogni progetto: attaccarci una chiamata a un modello significa
  moltiplicare il costo per un testo che forse nessuno leggerà.

## 4. Comportamento

1. Il lettore chiede la spiegazione con un pulsante. Non si genera nulla
   all'apertura della pagina: una pagina che spende soldi per essere guardata è
   una pagina che nessuno lascia aperta.
2. Il codice compone l'istantanea: verdetto, quota di sprint trascorsa, i cinque
   segnali con stato, cifre e la frase già scritta, e i verdetti precedenti con le
   rispettive date.
3. Il modello riceve i numeri **già scritti** e restituisce un oggetto JSON.
4. La risposta è validata, verificata e mostrata — oppure rifiutata e spiegata.

## 5. Criteri di accettazione

1. Nessuna cifra compare nella narrazione se non è fra quelle fornite dal codice
   (verifica di fedeltà numerica, la stessa di `sprint-report`).
2. Ogni osservazione è ancorata a uno dei cinque segnali, e a un segnale
   **valutabile**: ancorarla a un segnale «non valutabile» significherebbe
   commentare un dato mancante.
3. **Se non esiste alcun controllo precedente, il campo dell'andamento deve essere
   assente.** È il rifiuto più importante di questo incremento: un modello a cui
   si chiede «com'è cambiato» in mancanza di storia produce volentieri un
   andamento plausibile e inventato, e a differenza di un numero sbagliato non
   lascia traccia di essere falso.
4. La narrazione non nomina persone.
5. Un verdetto «non valutabile» non produce una narrazione: non c'è nulla da
   raccontare, e il codice lo dice da sé senza spendere token.
6. Il rifiuto è sempre spiegato al lettore con la sua ragione, mai mostrato come
   un errore generico.
7. L'esecuzione è registrata in `skill_runs` sia quando riesce sia quando è
   rifiutata.

## 6. Vincoli di `AGENTS.md`

- [x] **R1** — nessun numero è prodotto dal modello; l'istantanea è composta dal
      motore deterministico già testato.
- [x] **R2** — l'istantanea è costruita dal modello canonico, non da formati
      esterni.
- [x] **R3** — nessun testo ingerito entra in questo prompt: i segnali sono
      calcolati, non trascritti da commenti o descrizioni.
- [x] **R4** — l'output è vincolato da uno schema Zod in `src/domain`.
- [x] **§8.2** — nessuna metrica individuale, nessuna inferenza di emozioni: il
      prompt lo vieta e i segnali riguardano solo il processo.
- [x] **§9** — budget di token dichiarato; nessuna chiamata in test o in CI.

## 7. Questioni aperte

- **Q1 — Quante osservazioni.** Fissate a un massimo di quattro. Cinque segnali
  producono cinque osservazioni se il modello enumera invece di scegliere, e un
  testo che ripete l'elenco già visibile sopra non aggiunge nulla. Da rivedere se
  in pratica taglia qualcosa di utile.
- **Q2 — Rigenerazione.** Oggi ogni richiesta è una chiamata nuova. Se l'uso
  crescerà servirà una memoria breve per non pagare due volte lo stesso stato
  nello stesso minuto.
- **Q3 — Tre e2e falliscono solo dentro la suite completa.** ⚠️ *Non risolta, e
  dichiarata invece di aggirata.*

  `resoconto.spec.ts:58`, `spiegazione-salute.spec.ts:38` e `:70` passano
  **eseguiti da soli** e falliscono **nella suite intera**, sempre nello stesso
  punto: dopo aver premuto «Abilita …», la scheda continua a mostrare il pulsante
  di accensione.

  Cosa è stato misurato, per non ripartire da zero:

  - la scrittura funziona: leggendo la tabella subito prima e subito dopo il
    clic, il valore passa da `[]` a `["sprint-health"]`;
  - esiste **una sola** riga in `scrum_agents`, un solo progetto, un solo
    database (verificato host e conteggi);
  - l'ispettore appartiene a **una sola** organizzazione, con ruolo `admin`;
  - in un caso la tabella conteneva già `["sprint-health"]` **mentre** la pagina
    offriva «Abilita la salute dello sprint»: la pagina mostrava uno stato che
    non esisteva più;
  - non è la quota giornaliera (41 esecuzioni su un tetto di 50);
  - non è l'operatore jsonb: la stessa espressione, provata sul database,
    restituisce il risultato atteso;
  - `revalidatePath(..., "layout")` e un `reload()` esplicito dopo il clic **non**
    lo eliminano.

  Sono invece stati corretti, lungo l'indagine, due difetti veri che questo
  sintomo nascondeva: l'interruttore leggeva e riscriveva l'intero insieme delle
  capacità (accenderne una ne spegneva un'altra) e la disponibilità era dichiarata
  due volte, in `src/domain` e nelle etichette della scheda, già divergenti fra
  loro.

  Resta da capire perché la scheda serva una versione superata dopo una server
  action in una sessione lunga. Il sospetto aperto è il caching di rotta di Next
  in `next start`, che in sviluppo non si manifesta.
