---
applyTo: "src/connectors/**"
---

# Regole dei connettori

Vedi [ADR-0003](../../docs/architecture/ADR-0003-modello-canonico.md).

## Confinamento

Il formato nativo di una fonte esterna (`JiraIssue`, `GitHubIssue`, …) esiste **solo**
dentro `src/connectors/<fonte>/`. Verso l'esterno esponi esclusivamente entità canoniche
di `src/domain`. Un tipo nativo che sfugge da questa cartella è un errore bloccante.

## Obblighi

1. **Nessuna rete nei test.** Fixture registrate e anonimizzate.
2. **Idempotenza**: la chiave di riconciliazione è
   `(organization_id, source_system, source_id)`. Due ingestioni identiche non duplicano.
3. **Incrementalità**: conserva un cursore di sincronizzazione; il backfill è riavviabile
   dopo un'interruzione.
4. **Storia degli stati**: popola `StateTransition`. Se la fonte espone solo lo stato
   corrente, cerca lo storico dei cambiamenti; se non esiste, documenta la limitazione
   invece di fingere che il dato ci sia.
5. **Mappatura degli stati dichiarativa** e configurabile per progetto, non cablata.
6. **Rate limit**: backoff esponenziale con jitter. Ogni chiamata è ritentabile.
7. **Testo ingerito marcato come non fidato.**
8. **Segreti** solo da variabili d'ambiente: mai nei log, negli errori o nelle fixture.

Ogni connettore implementa la stessa interfaccia e supera la suite di conformità
condivisa. Il connettore `seed` è il riferimento.
