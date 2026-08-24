# Spec — Collo di bottiglia (`bottleneck-detection`)

- **Stato:** in sviluppo
- **Autore:** sviluppo
- **Data:** 2026-08-24
- **Traguardo di roadmap:** T5 — Salute dello sprint e colli di bottiglia

---

## 1. Problema

Il semaforo dello sprint dice **come sta andando**. Non dice **dove** il lavoro
si ferma.

Su questo progetto la differenza è già visibile: l'efficienza di flusso mediana
è del 23%, cioè per tre quarti del tempo un elemento non viene lavorato ma
aspetta. Sapere che si aspetta non basta per fare qualcosa: bisogna sapere **in
quale fase**, perché la risposta a «la revisione è ingolfata» è diversa da
quella a «il lavoro resta fermo su fornitori esterni».

Oggi quel dato esiste nei numeri e nessuna schermata lo dice. Si può dedurre
confrontando a mente attesa in revisione, tempo bloccato e cycle time — cioè
esattamente il lavoro che il prodotto dovrebbe fare al posto di chi guarda.

## 2. Risultato atteso

Nella pagina **Flusso di lavoro** compare dove il tempo si accumula: la
ripartizione fra le fasi, la fase di attesa che ne assorbe di più, e quanta
parte del totale è lavorazione vera.

Con una frase ripetibile in una riunione: *«fra presa in carico e chiusura, il
48% del tempo se ne va in revisione»*.

## 3. Perimetro

**Incluso**

- Il calcolo, **deterministico e in `src/metrics`**: quanto tempo gli elementi
  passano in ciascuno stato canonico, in totale e come quota.
- La distinzione fra **attesa** e **lavorazione**, che il dominio già dichiara
  con `isValueAdding`.
- L'indicazione della fase di attesa che assorbe più tempo.
- La presentazione nella pagina del flusso di lavoro, sotto le colonne.

**Escluso** *(sezione obbligatoria)*

- **Ogni suggerimento su cosa fare.** «Aggiungete un revisore» è una decisione
  sull'organizzazione del lavoro di persone: questo prodotto misura il processo
  senza dirigere chi lo esegue.
- La narrazione da parte dello Scrum Master AI: la capacità è dichiarata nel
  catalogo e resta non costruita finché il numero non è tarato su dati veri.
- Il confronto con altre squadre o con valori «di settore»: non ne abbiamo, e
  inventarne uno sarebbe una soglia senza fondamento.
- Qualunque attribuzione a una persona (§8.2). Una fase lenta è un fatto sul
  flusso, non su chi ci lavora.
- L'andamento nel tempo (il collo di bottiglia che si sposta di sprint in
  sprint): incremento successivo, e chiede più storia di quanta ne abbiamo.

## 4. Comportamento

### Percorso principale

1. Si apre la pagina **Flusso di lavoro** di un progetto.
2. Il codice scompone la storia degli stati di ogni elemento in tratti e somma
   il tempo per stato canonico.
3. Ogni fase riceve: tempo totale, quota sul totale, durata mediana per
   passaggio, quanti elementi ci sono passati.
4. Le fasi si mostrano ordinate per tempo assorbito, dalla maggiore.
5. La fase di **attesa** con più tempo viene nominata come collo di bottiglia;
   accanto si dichiara quanta parte del tempo è invece lavorazione.

### Percorsi alternativi

- **Nessuna storia di stati:** non si mostra nulla e si dice perché.
- **Nessuna attesa registrata** (tutto il tempo è lavorazione): non si nomina
  alcun collo di bottiglia. Dichiararne uno significherebbe eleggere il male
  minore a problema.
- **Una sola fase osservata:** si mostra, senza chiamarla collo di bottiglia:
  con un solo termine non esiste un confronto.

## 5. Dati coinvolti

| Entità | Lettura | Scrittura | Note |
|---|---|---|---|
| `StateTransition` | sì | no | l'unica fonte: i tratti si ricavano da qui |
| `WorkItem` | sì | no | solo per sapere quali elementi considerare |

Nessuna scrittura.

## 6. Criteri di accettazione

1. Il calcolo è una funzione pura in `src/metrics`, senza I/O e senza orologio.
2. La somma delle quote delle fasi è 1, a meno dell'errore di virgola mobile.
3. Ogni fase dichiara tempo totale, quota, mediana e numero di elementi.
4. Il collo di bottiglia è scelto **solo fra le fasi di attesa**, mai fra quelle
   che aggiungono valore.
5. Senza alcuna attesa registrata non viene nominato alcun collo di bottiglia.
6. Senza storia degli stati la metrica è indisponibile, non zero.
7. Un elemento ancora aperto contribuisce con il tratto in corso fino
   all'istante di riferimento.
8. Il risultato è ripetibile: due calcoli sugli stessi dati e allo stesso
   istante danno lo stesso esito.
9. Nessun campo del risultato nomina o identifica una persona.
10. Il tempo prima della presa in carico resta fuori, e la schermata lo dichiara.

## 7. Casi limite

| Caso | Comportamento atteso |
|---|---|
| Nessun dato disponibile | Metrica indisponibile con motivo, nessuna fase mostrata |
| Elementi senza transizioni | Ignorati: non si sa dove siano stati |
| Elementi mai presi in carico | Ignorati: la misura parte dalla lavorazione |
| Un solo elemento | Si calcola, e la numerosità del campione lo dichiara |
| Tutto il tempo in lavorazione | Nessun collo di bottiglia; quota di lavorazione 100% |
| Elemento ancora aperto | Il tratto in corso conta fino all'istante di riferimento |
| Transizioni fuori ordine | Riordinate prima del calcolo, come ogni altra metrica |
| Stato attraversato più volte | I tratti si sommano; la mediana è per passaggio |

## 8. Vincoli

- [x] I numeri sono calcolati in `src/metrics`, non dall'LLM (ADR-0002)
- [x] Passa dal modello canonico, nessun formato nativo esterno (ADR-0003)
- [ ] Se usa un LLM — **non ne usa nessuno in questo incremento**
- [ ] Se legge testo di terzi — non ne legge
- [x] Nessuna metrica individuale, nessuna inferenza emotiva (`AGENTS.md` §8.2)
- [x] Isolamento fra organizzazioni attraverso l'helper condiviso

## 9. Impatto sull'interfaccia

Nella pagina **Flusso di lavoro**, sotto le colonne: è la lettura che spiega
*perché* una colonna è piena, quindi va letta dopo averla vista.

- **Stato vuoto:** nessuna storia di stati, detto con la ragione.
- **Nessuna attesa:** si dichiara che il tempo è tutto lavorazione.
- Le quote sono barre **e** percentuali scritte: la lunghezza da sola non è
  leggibile da chi ascolta la pagina.

## 10. Come si verifica

- **Test unitari:** ogni caso limite della tabella §7, più la proprietà che le
  quote sommano a 1 e che il collo di bottiglia non è mai una fase di
  lavorazione.
- **Test di integrazione:** sullo scenario sintetico, dove la revisione si
  ingolfa di proposito, il collo di bottiglia **deve** risultare «in revisione».
  È il caso che dimostra che la metrica serve a qualcosa.
- **Verifica manuale:** aprire la pagina e confrontare la quota dichiarata con
  l'attesa in revisione mediana già mostrata sulla dashboard.

## 11. Questioni aperte

- [x] **Q1 — Il tempo in «da fare» va incluso?** — **decisa: no, e la schermata
      lo dichiara.**

      È attesa a tutti gli effetti, ma è attesa **prima** che il team prenda in
      carico il lavoro: è una scelta di priorità, non un ingolfamento del flusso.
      Includerla senza dirlo farebbe risultare «da fare» il collo di bottiglia di
      quasi ogni progetto — vero e inutile.

      La misura parte quindi dal **primo ingresso in lavorazione**, come già fa
      l'efficienza di flusso, e la pagina scrive che l'attesa in backlog resta
      fuori. Le due metriche misurano così lo stesso arco di tempo, e i loro
      numeri si possono confrontare.

- [ ] **Q2 — Quando una fase merita di essere chiamata «collo di bottiglia»?**
      Oggi si nomina la fase di attesa maggiore, senza soglia. Se il tempo fosse
      ripartito equamente fra tre code, nominarne una sarebbe arbitrario.

      *Proposta provvisoria: dichiarare la quota accanto al nome*, e lasciare a
      chi legge il giudizio se il 34% sia un collo di bottiglia o una
      distribuzione normale — invece di nascondere il dubbio dietro una soglia
      inventata. Una soglia si potrà scegliere quando ci saranno dati veri su cui
      tararla.
