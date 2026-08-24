# Spec — Salute dello sprint (`sprint-health`)

- **Stato:** implementata
- **Autore:** sviluppo
- **Data:** 2026-08-24
- **Traguardo di roadmap:** T5 — Salute dello sprint e colli di bottiglia

---

## 1. Problema

Oggi il sistema risponde solo quando gli si chiede qualcosa. La dashboard mostra i
numeri a chi la apre; il resoconto di sprint si genera premendo un pulsante. Chi
non guarda, non sa.

Il problema che uno Scrum Master risolve davvero non è raccontare uno sprint
finito: è **accorgersi che sta andando storto mentre è ancora in corso**, quando
si può ancora fare qualcosa. In questo progetto l'attesa in revisione è passata da
poche ore a due giorni e mezzo nell'arco di quattro sprint, e nessuno se n'è
accorto finché non è stata costruita la metrica apposta.

`sprint-health` è il primo pezzo della parte proattiva: un giudizio sullo stato
dello sprint **in corso**, con il motivo e l'evidenza.

## 2. Risultato atteso

Sulla dashboard del progetto compare un indicatore dello stato dello sprint
aperto — sereno, da tenere d'occhio, critico — accompagnato da:

- **il motivo**, in una frase;
- **i numeri** che lo hanno determinato, mostrati accanto;
- **cosa lo farebbe cambiare**, cioè quale soglia è stata superata e di quanto.

Un semaforo senza motivo è un colore. Ciò che lo rende utile è la seconda riga,
non la prima.

## 3. Perimetro

**Stato: implementato.** Il motore è in `src/metrics/health.ts`, il semaforo in
cima alla dashboard del progetto. Le questioni aperte sono decise in §11.

**Incluso**

- Il calcolo del giudizio: **deterministico, in `src/metrics`**, con soglie
  dichiarate e testate. Nessun modello linguistico decide un colore.
- I segnali del primo incremento, tutti calcolabili con metriche già esistenti:
  - **avanzamento contro tempo trascorso** — a metà sprint dovrebbe essere chiuso
    all'incirca metà del lavoro impegnato;
  - **lavoro aggiunto dopo l'inizio** oltre una quota dell'impegno iniziale;
  - **attesa in revisione** in crescita rispetto agli sprint precedenti;
  - **lavoro in corso** oltre il limite dichiarato dalla colonna, dove esiste;
  - **elementi fermi** oltre l'85° percentile del progetto (aging).
- La presentazione sulla dashboard.
- La narrazione del giudizio da parte dello Scrum Master AI, **facoltativa**: il
  colore e il motivo esistono anche senza modello.

**Escluso** *(sezione obbligatoria)*

- `bottleneck-detection`: è la domanda «quale fase rallenta», diversa da «come sta
  andando». Incremento successivo.
- Le entità persistite `Insight` e `Alert`: finché il giudizio si ricalcola a ogni
  visita non c'è nulla da conservare, e una tabella scritta prima di sapere cosa
  conterrà è una migrazione da rifare.
- L'esecuzione schedulata e le notifiche: nessun invio, nessun QStash. Un sistema
  che scrive a qualcuno va deciso, non aggiunto.
- Qualunque soglia configurabile dall'interfaccia. Prima le soglie devono
  dimostrarsi giuste su dati veri.

## 4. Comportamento

### Percorso principale

1. Si apre la dashboard di un progetto che ha uno sprint **in corso**.
2. Il codice calcola i segnali con `src/metrics`, ciascuno con il proprio esito:
   rispettato, superato, oppure **non valutabile**.
3. Ogni segnale superato produce un rilievo con: cosa è stato misurato, la soglia,
   il valore, e di quanto la supera.
4. Il giudizio complessivo è il **peggiore** fra i rilievi, secondo una regola
   scritta e testata — non una media, che nasconderebbe un problema grave sotto
   tre indicatori sereni.
5. La dashboard mostra il giudizio, il motivo e i numeri.

### Percorsi alternativi

- **Nessuno sprint in corso.** Non si mostra alcun semaforo, e si dice perché.
  Un indicatore verde su un progetto fermo è la peggiore delle risposte: afferma
  che va tutto bene proprio dove non sta succedendo nulla.
- **Sprint appena iniziato.** Sotto una frazione minima di tempo trascorso il
  segnale di avanzamento **non è valutabile**: al primo giorno essere all'8% non
  significa nulla, e chiamarlo «critico» insegnerebbe a ignorare il semaforo.
- **Segnale non valutabile** per mancanza di dati (nessuna stima, nessun limite di
  lavoro in corso dichiarato): si dichiara, non si assume che vada bene.
- **Tutti i segnali non valutabili:** il giudizio è «non valutabile», mai
  «sereno».

## 5. Dati coinvolti

| Entità | Lettura | Scrittura | Note |
|---|---|---|---|
| `Sprint` | sì | no | solo quello in corso |
| `WorkItem` | sì | no | |
| `StateTransition` | sì | no | la fonte di ogni durata |
| `SprintScopeEvent` | sì | no | per il lavoro aggiunto dopo l'inizio |
| `BoardColumn` | sì | no | per il limite di lavoro in corso, dove dichiarato |
| `ScrumAgent` | sì | no | solo se si vuole la narrazione |

Nessuna scrittura in questo incremento.

## 6. Criteri di accettazione

1. Il giudizio è calcolato da una funzione pura in `src/metrics`, senza I/O.
2. Nessuna chiamata a un modello è necessaria per ottenere colore e motivo.
3. Ogni rilievo dichiara: metrica, valore misurato, soglia, e scarto dalla soglia.
4. Il giudizio complessivo è il **peggiore** dei rilievi, non una media.
5. Uno sprint senza dati sufficienti produce «non valutabile», mai «sereno».
6. Un progetto senza sprint in corso non mostra alcun semaforo e dice perché.
7. Sotto la frazione minima di sprint trascorso l'avanzamento non è valutabile.
8. Ogni soglia è dichiarata in un solo posto, con scritto **perché** ha quel
   valore, e la sua modifica fa fallire un test che la cita.
9. Nessun segnale riguarda una persona: solo il processo (§8.2).
10. Il giudizio è **ripetibile**: due calcoli sugli stessi dati e allo stesso
    istante danno lo stesso risultato.
11. Se lo Scrum Master AI narra il giudizio, ogni numero citato è uno di quelli
    calcolati — vale la stessa verifica di fedeltà del resoconto di sprint.

## 7. Casi limite

| Caso | Comportamento atteso |
|---|---|
| Nessuno sprint in corso | Nessun semaforo, con il motivo scritto |
| Sprint iniziato oggi | Avanzamento non valutabile; gli altri segnali valgono |
| Sprint senza elementi | Tutti i segnali non valutabili; giudizio non valutabile |
| Nessuna stima sugli elementi | L'avanzamento si misura sui conteggi e lo dichiara |
| Stime in unità diverse | Avanzamento non valutabile: non si sommano |
| Nessun limite di lavoro in corso dichiarato | Il segnale non è valutabile, non «rispettato» |
| Meno di due sprint conclusi | L'attesa in revisione non ha termine di paragone: non valutabile |
| Sprint con date incoerenti | Non valutabile; non si finge una durata |
| Lo sprint finisce oggi | Valutabile: la frazione trascorsa è 100%, non oltre |

## 8. Vincoli

- [x] **Il giudizio è calcolato in `src/metrics`, non dall'LLM (R1, ADR-0002).**
      Il modello può raccontarlo; non può deciderlo né cambiarlo.
- [x] **Modello canonico (ADR-0003).** Nessun formato nativo esterno.
- [x] **Se narra: output vincolato a schema e verifica di fedeltà numerica**
      (ADR-0004, e la verifica già costruita per `sprint-report`).
- [x] **Testo di terzi trattato come dato** (§8.1).
- [x] **Nessun segnale individuale, nessuna inferenza emotiva** (§8.2). In
      particolare è vietato un segnale del tipo «il team è in difficoltà»: si
      misurano code, attese e riaperture, che sono fatti del processo.
- [x] **Isolamento fra organizzazioni** attraverso l'helper condiviso.

## 9. Impatto sull'interfaccia

Sulla dashboard del progetto, **in alto**: è la prima cosa da vedere, e metterla
in fondo la trasformerebbe in una nota.

- **Stato vuoto:** nessuno sprint in corso, detto con la ragione.
- **Non valutabile:** dichiarato come tale, con cosa manca per valutarlo.
- **Superato:** colore, motivo in una frase, e i numeri accanto.

Il colore non è mai l'unico portatore dell'informazione: chi non distingue il
rosso dal verde deve poter leggere la stessa cosa dal testo.

## 10. Come si verifica

- **Test unitari:** ogni segnale, ogni soglia, ogni caso limite della tabella §7.
  In particolare: il giudizio complessivo prende il peggiore e non la media;
  «non valutabile» non degrada mai in «sereno».
- **Test di integrazione:** il calcolo sullo scenario sintetico, dove l'attesa in
  revisione peggiora di proposito sprint dopo sprint: il segnale **deve**
  accendersi. È il caso che dimostra che serve a qualcosa.
- **Eval:** se il giudizio viene narrato, i casi dorati esistenti si estendono con
  la fedeltà numerica sul testo prodotto.
- **Verifica manuale:** aprire la dashboard e confrontare il motivo con i numeri
  mostrati accanto.

## 11. Questioni aperte

- [x] **Q1 — Quante fasce: due o tre?** — **decisa: tre** (sereno, da tenere
      d'occhio, critico), più «non valutabile» che non è una fascia ma l'assenza
      di giudizio. Due costringerebbero a chiamare «critico» ciò che merita solo
      attenzione, e un allarme che si accende spesso viene ignorato.

- [x] **Q2 — Quale scarto sull'avanzamento fa scattare l'attenzione?** —
      **decisa provvisoriamente: attenzione sotto il 70% del passo atteso,
      critico sotto il 40%.** Sono numeri da tarare su dati veri, ed è il motivo
      per cui non sono configurabili adesso: una soglia che si può cambiare senza
      doverla argomentare smette di essere una decisione. Vivono in
      `HEALTH_THRESHOLDS` e un test le cita una per una.

- [x] **Q3 — Il semaforo va mostrato anche a chi non è amministratore?** —
      **decisa: sì.** È un'informazione sul processo, non un'operazione:
      nasconderla non protegge nulla e renderebbe la dashboard diversa a seconda
      di chi guarda, che è il modo più rapido per far perdere fiducia in un
      numero.

- [x] **Q4 — Un giudizio critico va conservato quando lo sprint si chiude?** —
      **decisa: no, non in questo incremento.** Sarebbe la prima versione di
      `Insight`, e conservare qualcosa prima di sapere a cosa serve significa
      progettare una tabella per una domanda non ancora posta.

- [ ] **Q6 — Il confronto sull'attesa in revisione è leggermente sbilanciato, e
      va detto.**

      Il segnale divide l'attesa mediana in revisione dello sprint in corso per
      quella degli sprint conclusi. I due numeri però non sono misurati nello
      stesso modo: negli sprint chiusi quasi tutte le attese sono **finite** —
      l'elemento è uscito dalla revisione — mentre in quello in corso molte sono
      **ancora aperte** e si misurano fino a adesso. Un'attesa in corso cresce
      di ora in ora; una conclusa no.

      L'effetto spinge il rapporto verso l'alto anche a parità di
      comportamento. Sui dati sintetici il segnale riporta 13,6×, che coincide
      quasi esattamente con il peggioramento che il generatore inserisce di
      proposito (da 2-8 ore a 48-120), quindi oggi il numero **non è un
      artefatto** — ma parte di quel margine lo è, e su dati reali meno estremi
      la distorsione peserebbe di più.

      *Proposta provvisoria: lasciarlo così e dichiararlo.* Correggerlo significa
      scegliere fra due definizioni diverse — confrontare solo attese concluse,
      perdendo proprio gli elementi fermi che interessano, oppure troncare anche
      lo storico a una finestra equivalente — ed è una decisione da prendere
      guardando dati veri, non inventando la risposta adesso.

- [x] **Q5 — Come si dimostra, se nello scenario sintetico non c'è uno sprint in
      corso?** — **decisa: lo scenario si ancora all'istante di riferimento.**

      Non era una questione di stile: era un prerequisito. Lo scenario generava
      quattro sprint che finivano a maggio 2026, e i dati si guardano oggi. Il
      semaforo giudica lo **sprint aperto**, quindi allo stato precedente avrebbe
      mostrato sempre e solo lo stato vuoto «nessuno sprint in corso» — corretto,
      e inutile per capire se la funzione serve.

      Il generatore ora **riceve** l'istante di riferimento — non lo legge
      dall'orologio, come ogni altra cosa in questo progetto — e colloca gli
      sprint all'indietro a partire da lì, così l'ultimo è sempre a metà strada.

      **La parte non ovvia, ed è la ragione per cui la decisione non era gratis.**
      Uno sprint a metà non ha una storia intera: se il generatore scrivesse
      comunque tutte le transizioni dei quattordici giorni, il database
      conterrebbe eventi **datati domani** — elementi già conclusi in un futuro
      che non è avvenuto. Sarebbe un difetto peggiore di quello che si voleva
      risolvere, perché invisibile: ogni numero resterebbe plausibile.

      Quindi la generazione termina con un taglio dichiarato: **nulla nel lotto
      può portare una data successiva all'istante di riferimento**, e lo stato
      corrente di ogni elemento viene ricalcolato da ciò che resta. Un test
      cammina su ogni record e su ogni campo di data per verificarlo, perché una
      regola di questa forma si rompe aggiungendo un campo, non toccando quelli
      che c'erano.
