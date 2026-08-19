---
applyTo: "src/db/**,src/domain/**"
---

# Regole di modello dati e persistenza

## `src/domain`

Non importa **nulla** dagli altri livelli e non dipende da alcun framework.
Gli schemi Zod qui sono la fonte di verità: i tipi si derivano con `z.infer`.
I nomi seguono [`docs/domain-glossary.md`](../../docs/domain-glossary.md).

## `src/db`

1. **`organization_id` su ogni tabella di dominio.** Il filtro vive in un helper
   condiviso, mai ricopiato nei singoli punti di chiamata.
2. **Tutto in UTC**, con timestamp dotati di fuso orario. Conversione solo al bordo UI.
3. **Migrazioni versionate e committate.** Mai modificare una migrazione già applicata:
   se ne crea una nuova. Mai `db:push` verso un ambiente condiviso.
4. **`source_system` + `source_id`** su ogni entità importata, con unicità su
   `(organization_id, source_system, source_id)`: è ciò che rende idempotente l'ingestione.
5. **`StateTransition` è un'entità di primo livello**, indicizzata per
   `(work_item_id, occurred_at)`.
6. **`Person` pseudonimizzabile**: i dati identificativi in tabella separata.
7. Chiavi primarie UUID generate dall'applicazione.
8. Enum Postgres allineati agli enum Zod: un solo punto di definizione.
9. Vincoli di integrità nel database, non solo nel codice.

## Limiti dell'ambiente

Neon Free: 0,5 GB per progetto, pausa dopo 5 minuti di inattività.
Non conservare payload grezzi oltre il necessario; prevedi una politica di retention;
tollera il cold start della prima query senza trattarlo come errore.
