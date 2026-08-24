# Spec — Controllo schedulato della salute dello sprint

- **Stato:** in sviluppo
- **Autore:** sviluppo
- **Data:** 2026-08-24
- **Traguardo di roadmap:** T5 — Salute dello sprint e colli di bottiglia

---

## 1. Problema

Tutto, in questa applicazione, succede **quando qualcuno guarda**. La dashboard
calcola la salute dello sprint nel momento in cui si apre la pagina; il
resoconto si produce premendo un pulsante.

Ne segue una cosa che nessuna schermata può rimediare: **non esiste una
storia**. La salute dello sprint è sempre e solo quella di adesso. Se ieri era
serena e oggi è critica, il prodotto non lo sa — perché ieri nessuno ha
guardato, e guardare è l'unico modo in cui quel numero viene mai calcolato.

Il traguardo T5 promette che «il sistema segnala da solo un problema **prima**
che venga chiesto». Oggi il sistema *mostra*, non *si accorge*.

## 2. Risultato atteso

Una volta al giorno, senza che nessuno apra nulla, il sistema calcola la salute
di ogni sprint in corso e **ne conserva l'esito**.

Sulla dashboard del progetto compare l'andamento: com'era il giudizio nei giorni
scorsi, e quando è cambiato. Una frase del tipo *«critico da tre giorni; prima
era da tenere d'occhio»* dice qualcosa che nessuna singola misura può dire.

## 3. Perimetro

**Incluso**

- Una **rotta HTTP protetta** che esegue il controllo, invocabile da uno
  schedulatore esterno.
- Il **calcolo**, che è quello già esistente in `src/metrics`: il job non
  aggiunge aritmetica, la programma nel tempo.
- La **conservazione** dell'esito: giudizio, segnali e istante.
- La presentazione dell'andamento sulla dashboard del progetto.
- Idempotenza: due esecuzioni nello stesso giorno non producono due righe.

**Escluso** *(sezione obbligatoria)*

- **Le notifiche.** Nessun invio di email, messaggi o altro. Un sistema che
  scrive a qualcuno va deciso, non aggiunto di conseguenza: chi riceve, con
  quale frequenza e come si smette di ricevere sono domande che nessuno ha
  ancora posto.
- L'esecuzione di **skill LLM** dal job: nessuna narrazione automatica. Un
  modello che parte da solo, a costo, senza che nessuno lo abbia chiesto, è
  esattamente ciò che il budget dichiarato esiste per impedire.
- Soglie o frequenze configurabili dall'interfaccia.
- La conservazione del collo di bottiglia: si aggiungerà quando servirà una sua
  storia, non prima.

## 4. Comportamento

### Percorso principale

1. Lo schedulatore chiama la rotta protetta, una volta al giorno.
2. La rotta verifica il segreto condiviso. Senza, rifiuta.
3. Per **ogni progetto di ogni azienda** che ha uno sprint in corso, il codice
   calcola la salute con l'istante della richiesta.
4. L'esito viene conservato: giudizio, segnali, frazione di sprint trascorsa.
5. La risposta dice quanti progetti sono stati esaminati e quanti esiti scritti.

### Percorsi alternativi

- **Segreto assente o errato:** `401`, nessun lavoro svolto, nessuna traccia di
  cosa fosse il segreto atteso.
- **Nessuno sprint in corso in alcun progetto:** l'esecuzione riesce e dichiara
  zero esiti. Non è un errore: è la risposta giusta.
- **Salute non calcolabile** per uno sprint: si conserva comunque, con giudizio
  «non valutabile». È un fatto sul progetto, e ometterlo creerebbe un buco nella
  storia indistinguibile da un giorno in cui il job non è partito.
- **Seconda esecuzione nello stesso giorno:** aggiorna la riga di quel giorno
  invece di aggiungerne una. Un grafico con due punti per lo stesso giorno
  suggerirebbe una variazione che non c'è stata.

## 5. Dati coinvolti

| Entità | Lettura | Scrittura | Note |
|---|---|---|---|
| `Project` | sì | no | tutti, di tutte le aziende |
| `Sprint` | sì | no | serve quello in corso |
| `WorkItem`, `StateTransition`, `SprintScopeEvent` | sì | no | ingressi della metrica |
| `BoardColumn` | sì | no | per il limite di lavoro in corso |
| **`SprintHealthCheck`** | sì | **sì** | entità nuova |

### Sull'entità nuova, e sul nome

La roadmap parla di `Insight` e `Alert`. Sono nomi che descrivono un'ambizione,
non un contenuto: questa tabella conserva **un giudizio sulla salute di uno
sprint a un istante**, e chiamarla così la rende leggibile senza dover
indovinare cosa contenga. Un nome generico invita a metterci dentro qualunque
cosa, ed è così che una tabella diventa un deposito.

Il perimetro di `sprint-health` aveva rimandato la persistenza con un argomento
giusto: *«conservare qualcosa prima di sapere a cosa serve significa progettare
una tabella per una domanda non ancora posta»*. La domanda ora è posta, ed è
**«com'è cambiata la salute nel tempo»** — a cui il calcolo su richiesta non
potrà mai rispondere, perché esiste solo nell'istante in cui qualcuno guarda.

## 6. Criteri di accettazione

1. Senza il segreto corretto la rotta risponde `401` e non scrive nulla.
2. Il confronto del segreto è a tempo costante.
3. Il segreto non compare mai nella risposta, nei log o in un messaggio d'errore.
4. Un progetto senza sprint in corso non produce alcun esito.
5. Uno sprint la cui salute non è calcolabile produce comunque un esito, con
   giudizio «non valutabile».
6. Due esecuzioni nello stesso giorno UTC lasciano **una** riga per sprint.
7. Ogni riga porta `organization_id`, e la lettura passa dall'helper condiviso.
8. Il job non chiama alcun modello linguistico e non consuma token.
9. L'istante di riferimento è quello della richiesta, passato al calcolo: la
   metrica continua a non leggere l'orologio.
10. La dashboard mostra l'andamento solo se esiste più di un esito: con un solo
    punto non c'è un andamento, e disegnarlo suggerirebbe una stabilità non
    osservata.

## 7. Casi limite

| Caso | Comportamento atteso |
|---|---|
| Nessun dato disponibile | Esecuzione riuscita, zero esiti, detto nella risposta |
| Nessuno sprint in corso | Come sopra: non è un errore |
| Salute non calcolabile | Esito conservato con «non valutabile» |
| Due esecuzioni lo stesso giorno | Una riga sola, aggiornata |
| Progetti di aziende diverse | Ognuno con il proprio `organization_id`, mai mescolati |
| Sprint chiuso fra due esecuzioni | Smette di produrre esiti; quelli passati restano |
| Segreto non configurato sul server | `500` con un messaggio che non rivela nulla |

## 8. Vincoli

- [x] I numeri sono calcolati in `src/metrics`, non dall'LLM (ADR-0002)
- [x] Passa dal modello canonico, nessun formato nativo esterno (ADR-0003)
- [ ] Se usa un LLM — **non ne usa nessuno**, ed è una scelta dichiarata
- [ ] Se legge testo di terzi — non ne legge
- [x] Nessuna metrica individuale, nessuna inferenza emotiva (`AGENTS.md` §8.2)
- [x] Isolamento fra organizzazioni: ogni scrittura porta l'azienda, e le
      letture della dashboard passano dall'helper condiviso (§8.4)
- [x] Nessun segreto nel codice: solo variabili d'ambiente (§8.3)

## 9. Impatto sull'interfaccia

Sulla dashboard del progetto, **sotto** il semaforo: prima si legge come sta
adesso, poi da quanto.

- **Stato vuoto:** nessun controllo automatico ancora eseguito, detto con la
  ragione e con cosa manca per averne uno.
- **Un solo esito:** non si disegna un andamento.
- Il giudizio di ogni giorno è scritto a parole oltre che colorato.

## 10. Come si verifica

- **Test unitari:** la selezione dei progetti da esaminare, l'idempotenza per
  giorno, e il rifiuto senza segreto.
- **Test di integrazione:** l'esecuzione su un database vero produce righe con
  l'azienda giusta.
- **Verifica manuale:** invocare la rotta con il segreto e vedere comparire
  l'andamento sulla dashboard.

## 11. Questioni aperte

- [ ] **Q1 — A che ora del giorno?**
      *Proposta provvisoria: le 6:00 UTC.* Presto abbastanza da essere già
      calcolato quando qualcuno apre la dashboard la mattina, e abbastanza tardi
      da includere il lavoro della sera prima. Non è una decisione difficile da
      cambiare: è un parametro dello schedulatore.

- [ ] **Q2 — Per quanto si conservano gli esiti?**
      *Proposta provvisoria: per sempre, finché sono pochi.* Una riga per sprint
      al giorno è una crescita trascurabile, e cancellare storia è irreversibile.
      La domanda tornerà con dati veri e molti progetti.

- [ ] **Q3 — Chi deve poter vedere l'andamento?**
      *Proposta provvisoria: chiunque appartenga all'azienda*, come per il
      semaforo. È un'informazione sul processo, e renderla diversa a seconda di
      chi guarda è il modo più rapido per far perdere fiducia in un numero.
