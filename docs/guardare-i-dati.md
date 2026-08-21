# Guardare i dati di prova

Come vedere con i propri occhi cosa c'è dentro, senza fidarsi di quello che
racconta un agente.

Ci sono **tre strade**, dalla più immediata alla più diretta sul dato.

---

## 1. Dal sito pubblicato — la via più rapida

L'applicazione su Vercel e il computer di sviluppo **usano lo stesso database
Neon**. Non ci sono due copie dei dati: quello che vedi online è esattamente
quello che vede chi sviluppa.

1. Apri l'indirizzo di produzione (lo trovi su Vercel, sezione **Domains** del
   progetto)
2. **Accedi** — l'account è già registrato: `dibari62@gmail.com`
3. Dall'area azienda premi **Vai ai progetti**
4. Apri **Checkout**

Vedi la dashboard: metriche di flusso, burndown dello sprint più recente,
confronto fra i quattro sprint.

> L'indirizzo `scrum-master-<codice>-...vercel.app` **cambia a ogni pubblicazione**.
> Quello stabile, che punta sempre all'ultima versione, è nella pagina del
> progetto su Vercel.

### Se hai dimenticato la password

Il recupero password non esiste ancora. Nel frattempo:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm run seed        # non tocca gli account, ricarica solo i dati sintetici
```

e chiedi che ti venga reimpostata, oppure registra una seconda azienda da
`/registrati` — ma attenzione: **una nuova azienda non vede i dati di Checkout**,
perché ogni azienda vede solo i propri (è l'isolamento fra aziende, §8.4).

---

## 2. In locale — per vedere le modifiche prima che siano pubblicate

```powershell
cd "C:\Scrum Master AI"
$env:NODE_OPTIONS = "--use-system-ca"     # serve dietro il proxy aziendale
npm run dev
```

Poi apri <http://localhost:3000>.

> **Attenzione alla porta.** In `.env.local` c'è `AUTH_URL=http://localhost:3000`.
> Se avvii su un'altra porta, ogni accesso riuscito ti rimanda alla 3000 e sembra
> che il login non funzioni. Non è un guasto: è quella variabile.

Per rigenerare i dati sintetici da zero:

```powershell
npm run seed
```

Cancella e riscrive **solo** i dati con `source_system = 'seed'` del progetto
Checkout. Gli account e le aziende non vengono toccati.

---

## 3. Direttamente sul database — la via più vicina a un `RUNQRY`

Su Neon c'è un editor SQL nel browser. È il modo più diretto per verificare che
i numeri della dashboard corrispondano a ciò che c'è scritto davvero.

1. [console.neon.tech](https://console.neon.tech) → il progetto
2. **SQL Editor** nel menù a sinistra
3. Incolla una delle interrogazioni qui sotto

### Cosa c'è dentro

```sql
select
  (select count(*) from work_items)         as elementi,
  (select count(*) from state_transitions)  as transizioni,
  (select count(*) from sprints)            as sprint,
  (select count(*) from people)             as persone,
  (select count(*) from sprint_scope_events) as variazioni_perimetro;
```

### Gli sprint, con quanto lavoro contenevano

```sql
select
  s.name                                     as sprint,
  s.starts_at::date                          as inizio,
  s.ends_at::date                            as fine,
  count(w.id)                                as elementi,
  sum(w.estimate_value)                      as punti,
  count(*) filter (where w.estimate_value is null) as senza_stima
from sprints s
left join work_items w on w.sprint_id = s.id
group by s.id, s.name, s.starts_at, s.ends_at
order by s.starts_at;
```

La colonna `senza_stima` è quella che la dashboard riporta accanto alla velocity.
Se qui `punti` è tutto `null`, il caricamento non ha scritto le stime: è
esattamente il difetto trovato il 21 agosto.

> **Attenzione: `punti` qui non è la velocity.** Questa interrogazione somma le
> stime di **tutti** gli elementi assegnati allo sprint; la velocity somma solo
> quelli **conclusi entro la fine dello sprint**. Per lo sprint 4 questa query
> dice 43 punti e la dashboard ne mostra 15 — ed è giusto così: nove elementi su
> diciotto non sono stati finiti. Se i due numeri coincidessero, vorrebbe dire
> che la velocity sta contando anche il lavoro non consegnato.

### La storia di un singolo elemento

È la tabella più importante del sistema: quasi tutte le metriche si calcolano da
qui, non dallo stato attuale.

```sql
select
  w.title,
  t.from_state,
  t.to_state,
  t.occurred_at
from state_transitions t
join work_items w on w.id = t.work_item_id
where w.source_id = 'item-sprint-1-1'
order by t.occurred_at;
```

### Verificare a mano il cycle time di un elemento

Se il numero sulla dashboard non ti convince, questo lo ricalcola:

```sql
select
  w.title,
  min(t.occurred_at) filter (where t.to_state = 'in_progress') as avviato,
  min(t.occurred_at) filter (where t.to_state = 'done')        as concluso,
  min(t.occurred_at) filter (where t.to_state = 'done')
    - min(t.occurred_at) filter (where t.to_state = 'in_progress') as cycle_time
from state_transitions t
join work_items w on w.id = t.work_item_id
group by w.id, w.title
having min(t.occurred_at) filter (where t.to_state = 'done') is not null
order by cycle_time desc
limit 10;
```

Il codice calcola esattamente questo, in TypeScript e con i casi limite gestiti
(elemento riaperto, transizioni fuori ordine). Se i due risultati divergono in
modo sistematico, è un difetto e va segnalato.

### Quanto tempo si perde in revisione

```sql
select
  w.title,
  t.occurred_at as entrato_in_revisione,
  lead(t.occurred_at) over (partition by w.id order by t.occurred_at)
    - t.occurred_at as permanenza
from state_transitions t
join work_items w on w.id = t.work_item_id
where t.to_state = 'in_review'
order by permanenza desc nulls last
limit 10;
```

---

## Cosa aspettarsi di vedere

I dati sono **sintetici e deterministici**: lo stesso seme produce sempre la
stessa storia. Le persone sono inventate, su un dominio riservato che non può
raggiungere una casella vera.

La storia contiene **anomalie messe apposta**, per avere qualcosa da diagnosticare:

| Segnale | Sprint 1 → Sprint 4 |
|---|---|
| Cycle time mediano | 20,5 ore → 6,6 giorni |
| Lavoro trascinato | 1 su 9 → 9 su 18 |
| Perimetro | cresce a metà sprint 4 (la linea del burndown risale il 27 maggio) |

Una squadra che si impegna su sempre più lavoro, lo finisce sempre meno, e nel
frattempo la revisione si ingolfa. Se la dashboard **non** mostra questo, c'è un
difetto.

---

## Le regole valide anche qui

- **Nessun dato reale.** Persone inventate, dominio `example.invalid`.
- **Nessuna metrica per persona.** Il modello ha il campo `assignee_id`, ma
  aggregarlo per misurare le persone è vietato (`AGENTS.md` §8.2). Si misura il
  processo.
- **Ogni azienda vede solo i propri dati.** Se ti registri con una nuova azienda
  non vedrai Checkout: non è un guasto, è l'isolamento che funziona.
