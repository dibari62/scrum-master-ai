# Scrum dalle trincee — mappa fra il libro e il codice

> Riferimento: Henrik Kniberg, *Scrum and XP from the Trenches*, 2ª edizione, InfoQ 2015.
> Copia in `book/Scrum-and-XP-from-the-Trenches-2nd-edition.pdf`.
> Decisione di fedeltà: [ADR-0008](architecture/ADR-0008-fedelta-al-libro.md).

Questo documento esiste per una ragione sola: **poter verificare che il portale calcoli
davvero quello che il libro dice, senza rileggere il libro.** Ogni formula ha una riga,
e ogni riga dice dove sta il codice e quale test la dimostra.

Stato di una riga:

- ✅ implementata e verificata da un test che riproduce l'esempio del libro
- 🟡 implementata in parte, o implementata senza l'esempio del libro fra i test
- ⬜ non ancora implementata
- ⚠️ implementata **in modo divergente** dal libro — è un difetto, non una scelta

---

## 1. Velocity

| # | Formula del libro | Citazione | Dove | Test | Stato |
|---|---|---|---|---|---|
| V1 | La velocity effettiva è la somma delle stime **iniziali** delle storie completate. Le ri-stime fatte durante lo sprint si ignorano. | «the actual velocity is based on the *initial* estimates of each story. Any updates to the story time estimates done during the sprint are ignored» (pag. 29) | `src/metrics/sprint.ts` → `velocity`, `src/domain/estimate-change.ts`, tabella `estimate_changes` | `tests/metrics/sprint.test.ts` → «ignora una ri-stima fatta durante lo sprint»; `tests/connectors/seed.test.ts` → «la velocity conta la stima d'ingresso, non quella corretta dopo» | ✅ |
| V2 | Una storia quasi finita vale **zero**. Nessun credito parziale. | «The value of stuff half-done is zero (may in fact be negative)» (pag. 30) | `src/metrics/sprint.ts` → `velocity` | `tests/metrics/sprint.test.ts` | ✅ |
| V3 | Una storia conclusa e poi riaperta prima della chiusura non conta. | conseguenza di V2 e della definizione di *done* | `src/metrics/sprint.ts` → `velocity` | `tests/metrics/sprint.test.ts` | ✅ |
| Y2 | La velocity **stimata definitiva** di uno sprint è la somma delle storie effettivamente scelte, non il bersaglio di partenza. | «Since these four stories add up to 19 story points, their final estimated velocity for this sprint is 19» (pag. 32) | `src/metrics/planning.ts` → `committedVelocity` | `tests/metrics/planning.test.ts` → «somma le storie scelte, non il bersaglio» | ✅ |
| Y3 | Nel dubbio si prendono **meno** storie. | «When in doubt, choose fewer stories» (pag. 32) | linea guida, non calcolo | — | — |

> **Perché V1 è verde.** La regola vale ora **fino al database**: `EstimateChange` è
> un'entità canonica, la tabella `estimate_changes` esiste, il connettore `seed` la
> popola — 57 righe su 51 elementi — e ogni connettore futuro deve farlo, perché la
> suite di conformità lo verifica.
>
> La prova che il dato di esempio eserciti davvero la regola, e non passi per caso:
>
> | Sprint | ri-stime | velocity con stima **iniziale** | con stima **corrente** |
> |---|---|---|---|
> | 1 — Fondamenta del carrello | nessuna | 31 | 31 |
> | 2 — Metodi di pagamento | 2 | 32 | più alta |
> | 3 — Indirizzi e spedizione | 2 | 37 | più alta |
> | 4 — Conferma d'ordine | 3 | 42 | più alta |
>
> Lo sprint 1 non ha ri-stime **per costruzione**, quindi le due letture devono
> coincidere: è il controllo che dice che la differenza altrove non è rumore. Dagli
> altri tre, il codice di prima avrebbe riportato una velocity gonfiata — una squadra
> che sembra consegnare più di quanto si era impegnata a consegnare.

## 2. Capacità e previsione

| # | Formula del libro | Citazione / esempio | Dove | Stato |
|---|---|---|---|---|
| C1 | `man-days disponibili = Σ (giorni lavorativi × quota di allocazione) − assenze` | 15 giorni, 4 persone, Lisa 2 giorni di ferie, Dave al 50 % più 1 giorno di ferie ⇒ **50 man-days** (pag. 30) | `src/metrics/planning.ts` → `availableManDays` | ✅ |
| F1 | `focus factor = velocity effettiva ÷ man-days disponibili` | 18 punti su 45 man-days ⇒ **40 %** (pag. 31) | `src/metrics/planning.ts` → `focusFactor` | ✅ |
| F2 | `velocity stimata = man-days disponibili × focus factor` | 50 × 40 % ⇒ **20 punti** (pag. 31) | `src/metrics/planning.ts` → `estimatedVelocity`, metodo `focus-factor` | ✅ |
| F3 | Focus factor predefinito per un team nuovo: **70 %** | «The default focus factor I use for new teams is usually 70%» (pag. 32) | `DEFAULT_FOCUS_FACTOR`, metodo `default-focus-factor` | ✅ |
| Y1 | *Yesterday's weather*: velocity stimata = velocity dell'ultimo sprint, o media degli ultimi tre. | «pull in only as many story points as you got done last sprint (or the average of the last three sprints if you want to be fancy)» (pag. 89) | `src/metrics/planning.ts` → `yesterdaysWeather`, **metodo predefinito** | ✅ |
| R4 | Dopo ogni sprint si confronta effettiva vs stimata. | «After each sprint, we look at the actual velocity […] we revise the estimated velocity for future sprints» (pag. 101) | `src/metrics/planning.ts` → `forecastVariance` | 🟡 il confronto si calcola, la revisione del piano no |

> **Ogni riga ha un test che riproduce l'esempio stampato**, in
> `tests/metrics/planning.test.ts`: 49,5 man-days (il libro arrotonda a 50), 18/45 = 40 %,
> 50 × 40 % = 20, le quattro storie che fanno 19.
>
> **Una differenza dichiarata invece che nascosta.** Il libro scrive «50 available
> man-days»; l'aritmetica esatta del suo stesso esempio dà **49,5**
> (15 + 13 + 15 + 6,5). È un arrotondamento suo. Il test verifica 49,5 e controlla che
> arrotondi a 50, invece di piegare la formula per far tornare la cifra stampata.
>
> **F1–F3 sono ritrattati dall'autore.** Vedi ADR-0008: restano calcolabili, il
> predefinito è Y1 e la ritrattazione va mostrata accanto al numero.

## 3. Burndown

| # | Formula del libro | Citazione | Dove | Stato |
|---|---|---|---|---|
| B1 | Punti ancora aperti, un punto per **giorno lavorativo**. I fine settimana si saltano. | «We skip weekends on the X-axis […] it would flatten out over weekends, which would look like a warning sign» (pag. 62) | `src/metrics/sprint.ts` → `burndown`, `src/domain/working-calendar.ts` | ✅ |
| B2 | Linea di tendenza tratteggiata: dice se si è in rotta. | «The dashed trend line shows that they are approximately on track» (pag. 62) | `BurndownPoint.ideal` + `Burndown.totalWorkingDays` | ✅ |
| B3 | Senza stime sui task, il burndown si può fare **contando i task**. | «just count the tasks instead of adding up the hours» (pag. 66) | `BurndownPoint.openCount` esiste già | 🟡 |
| B4 | Il residuo di un giorno usa la stima di **quel** giorno: una ri-stima è parte della risposta corrente a «quanto manca». | pag. 62, per contrasto con V1 | `src/metrics/sprint.ts` → `burndown` | ✅ |

## 4. Pianificazione di rilascio

| # | Formula del libro | Citazione | Dove | Stato |
|---|---|---|---|---|
| R1 | Si tagliano gli sprint prendendo storie in ordine finché non si supera la velocity stimata. | «Each sprint includes as many stories as possible without exceeding the estimated velocity of 45» (pag. 100) | ⬜ | ⬜ |
| R2 | Soglie di accettazione: **must** / **should** / **may**. | «All items with importance >= 100 must be included in version 1.0» (pag. 97) | ⬜ | ⬜ **dipende da `backlogOrder`** — vedi nota |
| R3 | Variante a intervallo: velocity 30–50 ⇒ liste **All / Some / None**. | «All: these will all be done even if our velocity is low (30)» (pag. 101) | ⬜ | ⬜ |
| R4 | Dopo ogni sprint si confronta effettiva vs stimata e si rivede il piano. | «After each sprint, we look at the actual velocity […] we revise the estimated velocity for future sprints» (pag. 101) | `forecastVariance` + tabella «Previsto contro effettivo» | 🟡 il confronto si vede, la revisione automatica del piano no |

> **R2 sembra dipendere da un campo che il libro stesso abbandona, e non è così.**
> La regola d'esempio è scritta in termini di *importance* numerica — «items with
> importance >= 100» — e l'autore, nella 2ª edizione, ritratta proprio quella colonna:
> «there's no importance column. Instead, I just order the list» (§7 qui sotto).
> Sembra un vicolo cieco, ma poche righe dopo lo chiude lui: «and you can, of course,
> do this analysis **without having numeric importance ratings! Just order the list**».
> Quindi R2 si implementa sull'**ordine** del backlog, non su un punteggio — il che
> rende `backlogOrder` (§7) un **prerequisito** di R2, non una voce indipendente.

## 5. Stima

| # | Regola del libro | Citazione | Dove | Stato |
|---|---|---|---|---|
| E1 | Scala non lineare a valori discreti: fra 40 e 100 non c'è nulla, e **7 non esiste**. | «you can't cheat by combining a 5 and a 2 to make a 7. You have to choose either 5 or 8; there is no 7» (pag. 40) | `estimationScale` sul contesto di progetto, `isOnScale` e `estimationScaleConformance`; il mazzo è [ricostruito](#ricostruzione-b--il-mazzo-di-planning-poker-pag-38) | ✅ |
| E2 | Stima minima di un task: **0,5**. | «Our lowest value is 0.5» (pag. 65) | colonne `numeric(8,2)` dalla migrazione 0010; prima erano `integer` e **arrotondavano 0,5 a 1** | ✅ |
| E3 | Vecchia conversione, dichiarata superata: `1 man-day = 6 man-hours`. | «Our general formula was: 1 effective man-day = 6 effective man-hours» (pag. 65) | non implementata di proposito | — |
| E4 | Si stima il lavoro **totale** della storia, non la propria parte. | «The tester should not just estimate the amount of testing work» (pag. 40) | regola umana | — |

## 6. Linee guida numeriche

Sono **avvisi**, non vincoli: il libro le chiama *guideline*.

| # | Guideline | Citazione | Stato |
|---|---|---|---|
| G1 | Storie da **2 a 8** punti. Velocity tipica di un team: 40–60. | «We normally strive for stories weighted two to eight man-days» (pag. 43) | ✅ `planningGuidelines` |
| G2 | Da **5 a 15** storie per sprint. Meno di 5: storie troppo grandi. Più di 15: il team ha preso troppo. | pag. 43 | ✅ `planningGuidelines` |
| G3 | Tech story: **10–20 %** della capacità. | «10-20% of our time is spent on tech stories» (pag. 47) | ⛔ **non implementabile**: manca il campo |

> **Perché G3 non c'è, e non è una dimenticanza.** Il modello canonico non sa dire che
> un elemento serve al codice invece che a una persona: `WorkItemKind` distingue storia,
> bug, task, epic e spike, e nessuno di questi è una *tech story*. Dedurla dal tipo
> sarebbe sbagliato — un `task` in Scrum è un pezzo di una storia, non una storia
> tecnica — e una linea guida calcolata sull'insieme sbagliato è peggio di una assente,
> perché sembra una risposta. Serve un campo, e quindi una decisione: è la prossima
> voce del debito.


## 7. Il product backlog

I sei campi che il libro dichiara di aver usato «sprint after sprint» (pag. 6-7).

| Campo del libro | Nel nostro `WorkItem` | Nota |
|---|---|---|
| ID | `id` | ✅ |
| Name | `title` | ✅ |
| Importance | ⬜ | l'autore la **ritratta**: «there's no importance column. Instead, I just order the list». Implementeremo `backlogOrder`, non un numero. |
| Initial estimate | ✅ | `EstimateChange` conserva la storia; `estimate` resta la corrente |
| How to demo | ⬜ | «essentially a simple test spec» |
| Notes | `description` | 🟡 |

## 8. Cerimonie e operatività

| Elemento | Capitolo | Stato |
|---|---|---|
| Definition of Done | 4 | ✅ `projectContextSchema.definitionOfDone` |
| Definition of Ready | 4 (2ª ed.) | ⬜ |
| Calendario delle cerimonie | 4, 8 | ✅ `ceremonySchedule` |
| Sprint info page | 5 | ⬜ |
| Segnali d'allarme della lavagna | 6 | 🟡 [ricostruiti](#ricostruzione-a--i-segnali-dallarme-della-lavagna-pag-63): 5 dei 7 hanno già un corrispettivo in `sprintHealth`, scelto da noi prima di leggere il libro |
| Elementi non pianificati | 6 | 🟡 `scopeChange` li confonde con le aggiunte pianificate |
| Checklist della demo | 9 | ⬜ |
| Retrospettiva a tre colonne, voto, azioni | 10 | ✅ tre colonne del libro, voto aggregato, azioni con esito e seguito verificato |
| Statistiche di sprint | 16 | 🟡 la previsione si registra e si confronta con l'effettivo; i punti chiave della retrospettiva non vi confluiscono ancora |
| Checklist dello Scrum Master (inizio / ogni giorno / fine) | 16 | ⬜ **è l'ossatura**, vedi sotto |

> **La checklist del capitolo 16 non è una voce fra le altre: ne nomina quattro.**
> Trascritta dal testo (pag. 163), dice letteralmente di creare la *sprint info page*,
> di aggiornare le *statistiche di sprint* con velocity stimata e dimensione della
> squadra, di aggiungervi a fine sprint «the actual velocity **and key points from the
> retrospective**», e di avvisare della demo «**a day or two before**». Sono quattro
> voci del nostro elenco di cose da fare che il libro tratta come **un solo flusso**.
>
> | Momento | Voce del libro | Il portale può spuntarla da solo? |
> |---|---|---|
> | Inizio | Creare la sprint info page | sì, se la generiamo |
> | Inizio | Link alla pagina dalla bacheca | no — vive su un wiki esterno |
> | Inizio | Stamparla e appenderla al muro | **no**, e va detto invece di fingere |
> | Inizio | Email a tutti con obiettivo e link | solo se il portale manda email |
> | Inizio | Aggiornare le statistiche: velocity stimata, dimensione squadra, durata | ✅ già fatto (`sprint_statistics`) |
> | Ogni giorno | Daily scrum inizia e finisce in orario | no — nessun dato lo dice |
> | Ogni giorno | Storie aggiunte/tolte per tenere il ritmo | sì, dagli eventi di perimetro |
> | Ogni giorno | Il Product Owner è informato dei cambi | no — è una conversazione |
> | Ogni giorno | Backlog e burndown aggiornati | sì: si vede se ci sono transizioni recenti |
> | Ogni giorno | Impedimenti risolti o segnalati | sì, dagli impedimenti aperti e dalla loro durata |
> | Fine | Fare una demo aperta | no |
> | Fine | Avvisare della demo un giorno o due prima | sì, come promemoria calcolato dalle date |
> | Fine | Retrospettiva con squadra e Product Owner | ✅ già fatto |
> | Fine | Statistiche: velocity effettiva e punti chiave della retrospettiva | 🟡 la velocity sì, i punti chiave sono debito registrato |
>
> Metà delle voci **non è automatizzabile**, ed è una proprietà del lavoro dello Scrum
> Master, non un limite del portale. Una checklist che spuntasse da sola «daily scrum in
> orario» starebbe mentendo. Vanno mostrate lo stesso, marcate come umane: il libro
> chiude proprio dicendo di allenare la squadra a farle senza lo Scrum Master.

---

## Cosa non siamo riusciti a leggere dal PDF

Onestà obbligatoria: alcune parti del libro sono **immagini**, non testo, e non sono
state estratte.

| Contenuto | Pagina | Conseguenza |
|---|---|---|
| Elenco dei *task-board warning signs* | 63 | **ricostruito**, vedi sotto |
| Foto del mazzo di planning poker | 38 | **ricostruito**, vedi sotto |
| Grafico di burndown, rettangoli della velocity | 61-62 | le formule sono comunque descritte a parole |

---

## Figure ricostruite — **nostre, non del libro**

> **Decisione del Product Owner, 25/08/2026.** Le due figure che contano si ricostruiscono
> dal testo invece di trascriverle dall'immagine, e si marcano come nostre.
>
> **Questa sezione non è il libro.** È ciò che abbiamo dedotto da ciò che il libro dice a
> parole altrove. Ogni voce porta la prova testuale che la sostiene, oppure dichiara di
> non averne. Chi un giorno leggerà la figura vera deve poter confrontare — e correggerci.

### Ricostruzione A — I segnali d'allarme della lavagna (pag. 63)

Il testo introduce l'elenco e si ferma: «The Scrum master is responsible for making sure
that the team acts upon warning signs such as:» e la pagina successiva è già un altro
argomento. Delle voci non resta **nulla**.

Quello che segue è dedotto da altri passaggi del libro, con la loro pagina.

| # | Segnale ricostruito | Prova testuale | Solidità |
|---|---|---|---|
| S1 | **Molte storie iniziate, nessuna conclusa.** Il valore del lavoro a metà è zero. | «The value of stuff half-done is zero (may in fact be negative)» (pag. 30); l'esempio della lavagna a pag. 60 distingue esplicitamente ciò che è concluso, parziale, iniziato e non iniziato | alta |
| S2 | **Il lavoro in corso supera quello che la squadra riesce a reggere.** | gli avatar limitano il multitasking: «if each person only has like two magnets, that indirectly limits work in progress and multitasking. WTF, I'm out of avatars! Yeah, so stop starting and start finishing tasks!» (pag. 59) | alta |
| S3 | **Un elemento fermo in lavorazione senza che si sappia chi ci sta lavorando.** | «Sometimes, for larger teams, a task gets stuck in *Checked out* because nobody remembers who was working on it» (pag. 59) | alta |
| S4 | **Troppi elementi non pianificati.** | l'esempio di lavagna a pag. 60 tiene le interruzioni in un'area a sé — «We've had three unplanned items, as you can see down to the right. This is useful to remember when you do the sprint retrospective» — e la retrospettiva ha una voce apposita, «Too many external disturbances» (pag. 89) | alta |
| S5 | **Il ritmo non porta a chiudere entro la fine.** | la linea di tendenza del burndown: «The dashed trend line shows that they are approximately on track, i.e. at this pace they will complete everything by the end of the sprint» (pag. 62) | alta |
| S6 | **Qualcuno non sa cosa fare.** | un intero paragrafo, «Dealing with I don't know what to do today» (pag. 76-78), che nasce proprio dal guardare la lavagna insieme | media — il libro lo tratta al daily, non lo elenca fra i segnali |
| S7 | **La squadra ha preso più di quanto chiude, sprint dopo sprint.** | «We overcommitted and only got half of the stuff done» fra gli esiti tipici della retrospettiva (pag. 89) | media — è un esito di retrospettiva, non un segnale di lavagna |

**Cosa abbiamo già.** Cinque dei sette hanno un corrispettivo in `sprintHealth`: S1 e S5 in
`progress`, S2 in `wip-limit`, S4 in `scope-added`, S7 indirettamente in `progress`. **Non
li abbiamo ricavati dal libro** — li avevamo scelti noi, e la coincidenza è un buon segno,
non una conferma.

**Cosa manca.** S3 (elemento fermo senza titolare) e S6 (nessuno sa cosa fare) non sono
misurabili oggi: il primo richiederebbe di distinguere «in lavorazione senza assegnatario»
dal semplice aging, il secondo non lascia traccia nei dati.

> **Attenzione a S3 e §8.2.** «Chi ci sta lavorando» è a un passo dal contare quanto fa
> ciascuno, che è la metrica vietata numero uno. Se verrà implementato, il segnale dovrà
> dire *«un elemento è fermo e nessuno lo ha in carico»* — una proprietà dell'**elemento**
> — mai *«questa persona ha troppi elementi»*.

### Ricostruzione B — Il mazzo di planning poker (pag. 38)

Qui la ricostruzione è quasi **forzata** dal testo, e vale la pena mostrare perché.

Il testo vincola:

1. **Tredici carte**: «Each team member gets a deck of 13 cards as shown above».
2. Valori citati esplicitamente: **0**, **2**, **5**, **8**, **20**, **40**, **100**,
   **`?`**, **tazzina**.
3. «you can't cheat by combining a 5 and a 2 to make a 7. You have to choose either 5 or 8;
   there is **no 7**» ⇒ fra 5 e 8 non c'è nulla.
4. «there is nothing between 40 and 100».
5. «Our lowest value is **0.5**» (pag. 65) ⇒ esiste una carta sotto 1.

Nove carte sono nominate. Ne restano quattro, e la successione dev'essere non lineare, con
0,5 come minimo. La sola sequenza che soddisfa tutti e cinque i vincoli è quella di
Fibonacci arrotondata:

**0 · ½ · 1 · 2 · 3 · 5 · 8 · 13 · 20 · 40 · 100 · `?` · ☕** — tredici carte esatte.

Le quattro dedotte sono **½, 1, 3, 13**. Restano una deduzione: nessun passaggio del libro
le nomina.

> **Dove sta nel codice.** `PLANNING_POKER_DECK` in `src/domain/estimation-scale.ts`
> contiene gli **undici valori numerici**. `?` e la tazzina non ci sono: non sono
> dimensioni di una storia ma risposte sullo stimatore — «I have absolutely no idea» e
> «I'm too tired to think» — e nel modello canonico quello stato è `estimate: null`.
> Il commento sulla costante rimanda a questa sezione, così chi un giorno vedrà la
> figura vera saprà che cosa confrontare.

| Carta | Significato dichiarato dal libro |
|---|---|
| `0` | «This story is already done, or this story is pretty much nothing, just a few minutes of work» |
| `?` | «I have absolutely no idea at all. None.» |
| ☕ | «I'm too tired to think. Let's take a short break.» |

---
