# Spec — <nome della feature>

- **Stato:** bozza | approvata | in sviluppo | completata
- **Autore:** 
- **Data:** AAAA-MM-GG
- **Traguardo di roadmap:** 

---

## 1. Problema

Quale bisogno concreto risolve? Per chi? Cosa succede oggi in sua assenza?
Due o tre frasi. Se non riesci a spiegarlo qui, la feature non è chiara.

## 2. Risultato atteso

Come si capisce che la feature funziona, dal punto di vista di chi la usa.

## 3. Perimetro

**Incluso**
- 

**Escluso** *(sezione obbligatoria: impedisce agli agenti di espandere il lavoro)*
- 

## 4. Comportamento

Descrizione del comportamento osservabile. Non progettare la soluzione tecnica:
quella spetta all'Architect.

### Percorso principale
1. 

### Percorsi alternativi
- 

## 5. Dati coinvolti

Entità del [glossario di dominio](../../docs/domain-glossary.md) lette o scritte.
Se serve un concetto che non esiste ancora, va **prima** aggiunto al glossario.

| Entità | Lettura | Scrittura | Note |
|---|---|---|---|

## 6. Criteri di accettazione

Numerati e **verificabili da una macchina**: ogni criterio deve poter diventare un test.

- ❌ "il report deve essere utile e ben scritto"
- ✅ "il report contiene velocity, variazione di perimetro e lavoro trascinato; ogni
     numero citato nel testo è presente nell'oggetto metriche in input"

1. 
2. 
3. 

## 7. Casi limite

Sezione obbligatoria. Una spec senza casi limite viene rimandata indietro.

| Caso | Comportamento atteso |
|---|---|
| Nessun dato disponibile | |
| Sprint vuoto | |
| Fonte esterna non raggiungibile | |
| Progetto senza integrazioni configurate | |
| Dati parziali o incoerenti | |

## 8. Vincoli

Spuntare quelli applicabili e spiegare come vengono rispettati.

- [ ] I numeri sono calcolati in `src/metrics`, non dall'LLM (ADR-0002)
- [ ] Passa dal modello canonico, nessun formato nativo esterno (ADR-0003)
- [ ] Se usa un LLM: output vincolato a schema, budget di token dichiarato (ADR-0004)
- [ ] Se legge testo di terzi: trattato come dato non fidato (`AGENTS.md` §8.1)
- [ ] Nessuna metrica individuale, nessuna inferenza emotiva (`AGENTS.md` §8.2)
- [ ] Isolamento fra organizzazioni rispettato

## 9. Impatto sull'interfaccia

Schermate coinvolte. Come si presentano lo stato vuoto, il caricamento e l'errore.

## 10. Come si verifica

- Test unitari: 
- Test di integrazione: 
- Eval (se coinvolge un LLM): 
- Verifica manuale: 

## 11. Questioni aperte

Domande a cui **solo l'umano** può rispondere. Un agente non le indovina.

- [ ] 
