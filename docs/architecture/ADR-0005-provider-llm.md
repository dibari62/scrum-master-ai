# ADR-0005 — Provider LLM: Gemini primario, Groq di riserva, fittizio in sviluppo

- **Stato:** accettato
- **Data:** 2026-08-20
- **Decisori:** Giuseppe Di Bari

## Contesto

`.env.example` dichiara già `LLM_PROVIDER=gemini | groq | fake` e ADR-0001 cita "Gemini
free tier, fallback Groq" in una riga della tabella dello stack. La scelta è quindi di
fatto operativa, ma **nessun documento la motiva**: chi arriva dopo non sa perché, né
quali vincoli ne discendono. Questo ADR colma la lacuna prima che si creino gli account.

Il progetto è un proof-of-concept a costo tendente a zero. Per ADR-0004 il modello non
calcola nulla: riceve numeri già prodotti da `src/metrics` e li narra. Il carico è quindi
modesto e concentrato in pochi punti — sintesi testuale su input pre-filtrato.

**Fatto verificato sulla documentazione ufficiale dei prezzi (20/08/2026):** sul piano
gratuito di Gemini la voce *"Used to improve our products"* vale **Yes**; sul piano a
pagamento vale **No**. Il contenuto inviato al modello sul piano gratuito viene cioè
usato per migliorare i prodotti del fornitore.

Groq offre un piano gratuito con limiti espressi in richieste e token al minuto e al
giorno, sufficienti per un PoC.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — Gemini gratuito primario + Groq di riserva | costo zero, due fornitori indipendenti, contesto ampio su Gemini | contenuti usati per addestramento sul piano gratuito, limiti di frequenza |
| B — Un solo fornitore gratuito | meno codice, meno configurazione | un guasto o un cambio di condizioni ferma la dimostrazione |
| C — Fornitore a pagamento (OpenAI, Anthropic) | nessun uso dei dati, limiti ampi | costo ricorrente non giustificato per un portfolio |
| D — Modello locale (Ollama) | dati mai fuori dalla macchina, costo zero | qualità insufficiente per la narrazione, non distribuibile su Vercel |

## Decisione

**Gemini** come provider primario, **Groq** come riserva, entrambi sui rispettivi piani
gratuiti. In sviluppo e nei test il provider è **`fake`**: nessuna chiamata di rete,
nessun costo, risultati riproducibili.

La selezione avviene tramite `LLM_PROVIDER` ed è gestita esclusivamente dal gateway in
`src/lib/llm` (ADR-0004). Nessun modulo conosce il fornitore concreto.

Ogni fornitore ha la **propria** variabile di chiave (`GEMINI_API_KEY`, `GROQ_API_KEY`),
mai una condivisa: il passaggio alla riserva deve costare il cambio di una sola
variabile, non la riscrittura di una credenziale.

Finché si usano piani gratuiti, **al modello possono transitare solo dati sintetici o
non riservati**.

## Motivazione

Due fornitori invece di uno perché il rischio da coprire non è il costo, è
l'**indisponibilità durante una dimostrazione**. I piani gratuiti hanno limiti di
frequenza stretti e condizioni che possono cambiare senza preavviso; un secondo
fornitore raggiungibile cambiando una variabile d'ambiente trasforma un guasto
bloccante in un disservizio di trenta secondi. Il costo di questa ridondanza è basso
perché il gateway di ADR-0004 esiste comunque.

L'opzione C è scartata non per il prezzo in sé, ma perché non comprerebbe nulla che
serva **oggi**: il carico è una manciata di sintesi testuali su dati inventati. Diventerà
la scelta corretta nel momento in cui transiteranno dati reali — vedi "Quando
riconsiderare".

L'opzione D è scartata sulla qualità: la narrazione di un report destinato a uno
stakeholder è esattamente il compito in cui un modello piccolo eseguito in locale si
riconosce, e un report poco credibile vanifica il lavoro corretto fatto a monte
dalle metriche.

Il punto sull'addestramento merita di essere esplicito. `AGENTS.md` §8.2 impone già
persone fittizie e vieta dati reali di colleghi o clienti; era una regola di igiene del
modello dati. Con un provider gratuito che si addestra sull'input, **diventa un vincolo
tecnico irreversibile**: ciò che entra non esce più. Meglio scriverlo qui che scoprirlo
dopo aver collegato un repository aziendale.

## Conseguenze

**Positive**
- Costo effettivo pari a zero per tutta la durata del proof-of-concept.
- Un guasto di un fornitore non blocca una dimostrazione.
- I test non dipendono dalla rete né da una chiave: girano ovunque, sempre uguali.

**Negative / costi accettati**
- Sul piano gratuito i contenuti inviati alimentano il miglioramento dei prodotti del
  fornitore: accettabile **solo** con dati sintetici.
- Limiti di frequenza stretti: una dimostrazione con molte esecuzioni ravvicinate può
  incontrarli.
- Due fornitori significano due formati di errore e due comportamenti da normalizzare
  nel gateway.

**Vincoli che ne derivano per il codice**
- `LLM_PROVIDER=fake` è il valore predefinito in sviluppo e **l'unico ammesso in CI e
  nei test unitari** (`AGENTS.md` §9).
- Una variabile di chiave **per fornitore** (`GEMINI_API_KEY`, `GROQ_API_KEY`). Il
  gateway sceglie quale leggere in base a `LLM_PROVIDER`; il passaggio alla riserva non
  deve richiedere di spostare credenziali a mano.
- Il provider si sceglie solo tramite variabile d'ambiente. Nessun `if (provider === …)`
  fuori da `src/lib/llm`.
- Il passaggio al fornitore di riserva è una decisione del gateway, non del chiamante.
  Una skill non sa quale modello l'ha servita.
- Nessun dato reale relativo a persone identificabili viene inviato a un provider su
  piano gratuito. I connettori verso fonti reali (T7) devono essere valutati anche sotto
  questo profilo prima di essere attivati.
- Le chiavi vivono in `.env.local` e nelle variabili d'ambiente della piattaforma, mai
  nel codice (`AGENTS.md` §8.3).

## Quando riconsiderare

- **Al primo dato reale.** Se il sistema ingerisce ticket o commenti di persone vere,
  il piano gratuito non è più adeguato: si passa a un piano a pagamento con uso dei dati
  escluso, oppure si anonimizza a monte in modo verificabile.
- Se i limiti di frequenza gratuiti rendono la dimostrazione inaffidabile.
- Se la qualità della narrazione risulta insufficiente su un dataset dorato: in quel caso
  il problema è il modello, non l'architettura, e si cambia modello senza toccare le skill.
