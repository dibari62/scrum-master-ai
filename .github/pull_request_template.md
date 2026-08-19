# Cosa cambia

<!-- Una o due frasi. Se non riesci a riassumerla, la PR è troppo grande. -->

Spec di riferimento: `specs/<feature>/spec.md`

## Perché

<!-- Il problema risolto, non l'elenco dei file toccati. -->

## Come verificare

<!-- Passi concreti per riprodurre il comportamento. -->

---

## Lista di controllo

- [ ] `npm run verify` passa in locale
- [ ] I criteri di accettazione della spec sono soddisfatti
- [ ] Nuovi comportamenti coperti da test, casi limite inclusi
- [ ] Nessun test è stato indebolito, cancellato o messo in skip
- [ ] Nomi conformi a `docs/domain-glossary.md`
- [ ] Confini architetturali rispettati (`node scripts/check-boundaries.mjs`)
- [ ] Nessun segreto in chiaro; `.env.example` aggiornato se servono nuove variabili

Se la modifica tocca metriche o skill:

- [ ] I numeri sono calcolati in `src/metrics`, non dall'LLM (ADR-0002)
- [ ] Gli output LLM sono vincolati a schema e validati (ADR-0004)
- [ ] Le eval passano; il dataset dorato è aggiornato
- [ ] Nessuna metrica individuale, nessuna inferenza emotiva (`AGENTS.md` §8.2)

Se la modifica tocca dati o API:

- [ ] Migrazione generata e committata
- [ ] Isolamento fra organizzazioni verificato da test
- [ ] Input validati con Zod al bordo; autorizzazione verificata

## Decisioni aperte

<!-- Cosa il revisore deve valutare, o cosa hai deciso senza esserne certo. -->
