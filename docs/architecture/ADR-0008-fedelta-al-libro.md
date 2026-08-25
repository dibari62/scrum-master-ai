# ADR-0008 — Fedeltà alle formule di *Scrum and XP from the Trenches*

- **Stato:** accettato
- **Data:** 2026-08-25
- **Decisori:** Giuseppe Di Bari
- **Fonte:** Henrik Kniberg, *Scrum and XP from the Trenches*, 2ª edizione, InfoQ 2015

## Contesto

Il portale calcola velocity, burndown, perimetro e lavoro trascinato. Finora quelle
definizioni le abbiamo scelte noi, ragionando caso per caso. Sono difendibili, ma non
sono ancorate a niente: se domani qualcuno chiede «perché la velocity si calcola così»,
la risposta è «ci sembrava giusto».

*Scrum and XP from the Trenches* è il resoconto operativo di uno Scrum Master che quelle
formule le ha usate per anni, e le scrive per esteso con gli esempi numerici. Prenderlo
come riferimento dichiarato trasforma ogni formula da preferenza a citazione.

C'è però una complicazione, ed è il motivo per cui questo ADR esiste. La 2ª edizione è
il libro del 2007 **con l'autore che commenta se stesso otto anni dopo**, e in più punti
si smentisce. Sul focus factor, che è il cuore del capitolo sulla pianificazione, scrive:

> «I never use focus factor any more because it takes time, gives a false sense of
> accuracy, and forces you to estimate stories in ideal man-days.»

Quindi il libro contiene **due** metodi per calcolare la stessa cosa, e uno dei due è
sconsigliato dall'autore stesso.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — Solo le formule del 2007, focus factor incluso e predefinito | massima aderenza letterale | il portale insegnerebbe come predefinita una pratica che l'autore definisce dannosa |
| B — Solo ciò che l'autore raccomanda oggi | prodotto più semplice, più onesto | perdiamo metà del contenuto del libro, e la capacità del team resta incalcolabile |
| C — Entrambe, con `yesterday's weather` predefinito e il focus factor mostrato insieme alla ritrattazione | copertura completa, e la ritrattazione diventa contenuto | più codice, e il conflitto sulle unità di stima va risolto |

## Decisione

**Opzione C.**

1. Si implementano **tutte** le formule del libro, quelle del 2007 e quelle della 2ª
   edizione.
2. Il metodo predefinito per la velocity stimata è **yesterday's weather**: velocity
   dell'ultimo sprint, o media degli ultimi tre.
3. Il **focus factor** resta calcolabile e visibile, ma ovunque compaia
   nell'interfaccia è accompagnato dalla ritrattazione dell'autore. Non è una nota a
   piè di pagina nascosta: è parte di ciò che il portale insegna.
4. Quando un progetto non ha storia sufficiente per lo yesterday's weather, il ripiego
   è il **70 %** che il libro indica come predefinito per i team nuovi, e il portale
   dichiara che sta usando un ripiego.

## La regola sulle unità di stima

È il punto in cui il libro e il nostro motore non vanno d'accordo, e va deciso qui
invece di scoprirlo in produzione.

Il libro tratta gli story point come **«ideal man-days»**: è proprio questa equivalenza
che rende sensato dividere punti per man-days e ottenere una percentuale. Il nostro
motore invece tiene punti e ore rigorosamente separati (`EstimateTotals`), perché
sommare tre punti e mezza giornata produce un numero che sembra corretto e non
significa niente.

Non arretriamo sulla separazione. Quindi:

> **Il focus factor si calcola solo quando tutte le stime dello sprint sono nella
> stessa unità.** Con unità miste il risultato è `unavailable` con motivo esplicito,
> mai un numero.

Stessa regola per la velocity stimata calcolata con il metodo `man-days × focus factor`.
Lo yesterday's weather non ha questo problema: confronta velocity con velocity, quindi
resta calcolabile per unità.

## La velocity si calcola sulla stima iniziale

Formulato qui perché corregge un comportamento che il portale ha già.

> «Note that the actual velocity is based on the **initial** estimates of each story.
> Any updates to the story time estimates done during the sprint are ignored.»

Oggi `velocity()` legge `WorkItem.estimate`, cioè la stima **corrente**. Conseguenza:
correggere la stima di una storia oggi cambia la velocity di uno sprint chiuso tre
settimane fa. È lo stesso errore che ADR-0003 ha già respinto per gli stati — una
fotografia non ricostruisce una storia — applicato alle stime invece che agli stati.

La soluzione è la stessa: un evento canonico `EstimateChange`, e la velocity legge la
stima **nell'istante in cui l'elemento è entrato nello sprint**.

> Per un elemento entrato a metà sprint, «iniziale» significa all'ingresso, non
> all'inizio dello sprint: prima non faceva parte del piano, e non c'era nessuna stima
> da onorare.

## Il burndown salta i fine settimana

> «We skip weekends on the X-axis since work is rarely done on weekends. We used to
> include weekends but this would make the burn down slightly confusing, since it would
> flatten out over weekends, which would look like a warning sign.»

Il nostro burndown campiona ogni 24 ore su tutti i giorni di calendario, mentre i dati
sintetici saltano i fine settimana. Il grafico mostra quindi esattamente l'altopiano
piatto che il libro descrive come falso allarme, e che ha smesso di disegnare nel 2007.

Serve un `WorkingCalendar` nel modello canonico. **Non** si importa
`src/connectors/seed/calendar.ts`: la direzione delle dipendenze di `AGENTS.md` §4 lo
vieta, e comunque il calendario è una proprietà del progetto, non del connettore che lo
ha popolato.

## Conseguenze

**Positive**
- Ogni formula ha una citazione, non un'opinione.
- Ogni formula ha un test che riproduce **l'esempio numerico stampato nel libro**: 50
  man-days, 18/45 = 40 %, 50 × 40 % = 20, le quattro storie che fanno 19, il piano di
  rilascio con velocity 45. Se il codice non ritrova quei numeri, ha torto il codice.
- La ritrattazione dell'autore diventa contenuto didattico invece di una scelta nostra
  da giustificare.

**Negative / costi accettati**
- Due metodi di previsione da mantenere invece di uno.
- Il modello canonico cresce: `EstimateChange`, `WorkingCalendar`,
  `TeamMemberAvailability`.
- Il focus factor sarà `unavailable` per i progetti che mescolano punti e ore. È il
  comportamento voluto, ma va spiegato nell'interfaccia o sembrerà un guasto.

**Vincolo che ne deriva, da `AGENTS.md` §8.2**

La disponibilità di una persona (ferie, part-time) è un dato di **calendario**, non di
rendimento. La capacità esiste solo come totale di squadra: nessuna API espone quanti
punti ha chiuso una singola persona, e non dev'essere possibile derivarlo. Modellare le
assenze è legittimo; usarle per dividere la velocity per persona è la metrica vietata
numero uno.

## Quando riconsiderare

Se un team reale usa il portale e trova che lo yesterday's weather sbaglia
sistematicamente la previsione dove il focus factor la azzecca, l'ordine dei
predefiniti si può invertire. Non prima: oggi non abbiamo un solo dato reale su cui
fondare quel giudizio.
