# Spec — Salute dello sprint (`sprint-health`)

- **Stato:** bozza
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

- [ ] **Q1 — Quante fasce: due o tre?**
      *Proposta provvisoria: tre* (sereno, da tenere d'occhio, critico). Due
      costringono a chiamare «critico» ciò che merita solo attenzione, e un
      allarme che si accende spesso viene ignorato.

- [ ] **Q2 — Quale scarto sull'avanzamento fa scattare l'attenzione?**
      *Proposta provvisoria: attenzione sotto il 70% dell'avanzamento atteso,
      critico sotto il 40%.* Sono numeri da tarare su dati veri, ed è il motivo
      per cui non sono configurabili adesso: una soglia che si può cambiare senza
      doverla argomentare smette di essere una decisione.

- [ ] **Q3 — Il semaforo va mostrato anche a chi non è amministratore?**
      *Proposta provvisoria: sì.* È un'informazione sul processo, non
      un'operazione: nasconderla non protegge nulla e renderebbe la dashboard
      diversa a seconda di chi guarda, che è il modo più rapido per far perdere
      fiducia in un numero.

- [ ] **Q4 — Un giudizio critico va conservato quando lo sprint si chiude?**
      *Proposta provvisoria: no, non in questo incremento.* Sarebbe la prima
      versione di `Insight`, e conservare qualcosa prima di sapere a cosa serve
      significa progettare una tabella per una domanda non ancora posta.

- [ ] **Q5 — Come si dimostra, se nello scenario sintetico non c'è uno sprint in
      corso?**
      Non è una questione di stile: è un prerequisito. Lo scenario genera quattro
      sprint che finiscono a maggio 2026, e i dati si guardano oggi. Il semaforo
      giudica lo **sprint aperto**, quindi allo stato attuale mostrerebbe sempre e
      solo lo stato vuoto «nessuno sprint in corso» — corretto, e inutile per
      capire se la funzione serve.

      *Proposta provvisoria: ancorare lo scenario all'istante in cui viene
      generato*, così l'ultimo sprint è sempre a metà strada. Ha un costo da
      dichiarare — i test di integrazione che oggi citano date fisse andrebbero
      ripensati — e va deciso **prima** di scrivere il motore, non dopo.
