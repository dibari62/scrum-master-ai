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
| V1 | La velocity effettiva è la somma delle stime **iniziali** delle storie completate. Le ri-stime fatte durante lo sprint si ignorano. | «the actual velocity is based on the *initial* estimates of each story. Any updates to the story time estimates done during the sprint are ignored» (pag. 29) | `src/metrics/sprint.ts` → `velocity` | `tests/metrics/sprint.test.ts` → «ignora una ri-stima fatta durante lo sprint», «usa la stima all'ingresso per un elemento aggiunto a metà sprint» | 🟡 |
| V2 | Una storia quasi finita vale **zero**. Nessun credito parziale. | «The value of stuff half-done is zero (may in fact be negative)» (pag. 30) | `src/metrics/sprint.ts` → `velocity` | `tests/metrics/sprint.test.ts` | ✅ |
| V3 | Una storia conclusa e poi riaperta prima della chiusura non conta. | conseguenza di V2 e della definizione di *done* | `src/metrics/sprint.ts` → `velocity` | `tests/metrics/sprint.test.ts` | ✅ |
| Y2 | La velocity **stimata definitiva** di uno sprint è la somma delle storie effettivamente scelte, non il bersaglio di partenza. | «Since these four stories add up to 19 story points, their final estimated velocity for this sprint is 19» (pag. 32) | ⬜ | ⬜ | ⬜ |
| Y3 | Nel dubbio si prendono **meno** storie. | «When in doubt, choose fewer stories» (pag. 32) | linea guida, non calcolo | — | — |

> **Perché V1 è gialla e non verde.** Il motore è corretto e coperto da test: data
> una storia delle stime, usa quella d'ingresso. Ma il connettore `seed` non produce
> ancora `EstimateChange`, e non esiste la tabella che li conserva — quindi
> nell'applicazione in esecuzione la velocity ricade sulla stima corrente, che è il
> comportamento dichiarato per una fonte senza storia. **Verde solo quando la storia
> delle stime arriva davvero fino al database.**

## 2. Capacità e previsione

| # | Formula del libro | Citazione / esempio | Dove | Stato |
|---|---|---|---|---|
| C1 | `man-days disponibili = Σ (giorni lavorativi × quota di allocazione) − assenze` | 15 giorni, 4 persone, Lisa 2 giorni di ferie, Dave al 50 % più 1 giorno di ferie ⇒ **50 man-days** (pag. 30) | ⬜ | ⬜ |
| F1 | `focus factor = velocity effettiva ÷ man-days disponibili` | 18 punti su 45 man-days ⇒ **40 %** (pag. 31) | ⬜ | ⬜ |
| F2 | `velocity stimata = man-days disponibili × focus factor` | 50 × 40 % ⇒ **20 punti** (pag. 31) | ⬜ | ⬜ |
| F3 | Focus factor predefinito per un team nuovo: **70 %** | «The default focus factor I use for new teams is usually 70%» (pag. 32) | ⬜ | ⬜ |
| Y1 | *Yesterday's weather*: velocity stimata = velocity dell'ultimo sprint, o media degli ultimi tre. | «pull in only as many story points as you got done last sprint (or the average of the last three sprints if you want to be fancy)» (pag. 89) | ⬜ | ⬜ |

> **F1–F3 sono ritrattati dall'autore.** Vedi ADR-0008: restano calcolabili, ma il
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
| R2 | Soglie di accettazione: **must** / **should** / **may**. | rosso = must in 1.0, giallo = should, verde = rimandabile (pag. 97) | ⬜ | ⬜ |
| R3 | Variante a intervallo: velocity 30–50 ⇒ liste **All / Some / None**. | «All: these will all be done even if our velocity is low (30)» (pag. 101) | ⬜ | ⬜ |
| R4 | Dopo ogni sprint si confronta effettiva vs stimata e si rivede il piano. | «After each sprint, we look at the actual velocity […] we revise the estimated velocity for future sprints» (pag. 101) | ⬜ | ⬜ |

## 5. Stima

| # | Regola del libro | Citazione | Dove | Stato |
|---|---|---|---|---|
| E1 | Scala non lineare a valori discreti: fra 40 e 100 non c'è nulla, e **7 non esiste**. | «you can't cheat by combining a 5 and a 2 to make a 7. You have to choose either 5 or 8; there is no 7» (pag. 40) | `estimateSchema` accetta qualsiasi numero | ⚠️ |
| E2 | Stima minima di un task: **0,5**. | «Our lowest value is 0.5» (pag. 65) | ⬜ | ⬜ |
| E3 | Vecchia conversione, dichiarata superata: `1 man-day = 6 man-hours`. | «Our general formula was: 1 effective man-day = 6 effective man-hours» (pag. 65) | non implementata di proposito | — |
| E4 | Si stima il lavoro **totale** della storia, non la propria parte. | «The tester should not just estimate the amount of testing work» (pag. 40) | regola umana | — |

## 6. Linee guida numeriche

Sono **avvisi**, non vincoli: il libro le chiama *guideline*.

| # | Guideline | Citazione | Stato |
|---|---|---|---|
| G1 | Storie da **2 a 8** punti. Velocity tipica di un team: 40–60. | «We normally strive for stories weighted two to eight man-days» (pag. 43) | ⬜ |
| G2 | Da **5 a 15** storie per sprint. Meno di 5: storie troppo grandi. Più di 15: il team ha preso troppo. | pag. 43 | ⬜ |
| G3 | Tech story: **10–20 %** della capacità. | «10-20% of our time is spent on tech stories» (pag. 47) | ⬜ |

## 7. Il product backlog

I sei campi che il libro dichiara di aver usato «sprint after sprint» (pag. 6-7).

| Campo del libro | Nel nostro `WorkItem` | Nota |
|---|---|---|
| ID | `id` | ✅ |
| Name | `title` | ✅ |
| Importance | ⬜ | l'autore la **ritratta**: «there's no importance column. Instead, I just order the list». Implementeremo `backlogOrder`, non un numero. |
| Initial estimate | 🟡 `estimate` esiste, ma senza storia: vedi V1 | |
| How to demo | ⬜ | «essentially a simple test spec» |
| Notes | `description` | 🟡 |

## 8. Cerimonie e operatività

| Elemento | Capitolo | Stato |
|---|---|---|
| Definition of Done | 4 | ✅ `projectContextSchema.definitionOfDone` |
| Definition of Ready | 4 (2ª ed.) | ⬜ |
| Calendario delle cerimonie | 4, 8 | ✅ `ceremonySchedule` |
| Sprint info page | 5 | ⬜ |
| Segnali d'allarme della lavagna | 6 | 🟡 `sprintHealth` guarda cose analoghe, scelte da noi |
| Elementi non pianificati | 6 | 🟡 `scopeChange` li confonde con le aggiunte pianificate |
| Checklist della demo | 9 | ⬜ |
| Retrospettiva a tre colonne, voto, azioni | 10 | ⬜ |
| Statistiche di sprint | 16 | ⬜ |
| Checklist dello Scrum Master (inizio / ogni giorno / fine) | 16 | ⬜ |

---

## Cosa non siamo riusciti a leggere dal PDF

Onestà obbligatoria: alcune parti del libro sono **immagini**, non testo, e non sono
state estratte.

| Contenuto | Pagina | Conseguenza |
|---|---|---|
| Elenco dei *task-board warning signs* | 63 | va letto con gli occhi prima di implementare i segnali d'allarme |
| Foto del mazzo di planning poker | 38 | il testo conferma 0, 5, 8, 20, 40, 100, `?` e la tazzina, e che le carte sono 13; il resto è dedotto dal mazzo Crisp standard |
| Grafico di burndown, rettangoli della velocity | 61-62 | le formule sono comunque descritte a parole |
