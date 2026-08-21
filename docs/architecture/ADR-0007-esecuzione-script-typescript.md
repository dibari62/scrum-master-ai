# ADR-0007 — `tsx` per eseguire script TypeScript fuori dal bundler

- **Stato:** proposto
- **Data:** 2026-08-21
- **Decisori:** Giuseppe Di Bari

## Contesto

`npm run seed` deve caricare i dati sintetici nel database. Lo script ha bisogno
di importare `src/connectors/seed`, `src/db` e `src/domain`: codice TypeScript,
esattamente quello che l'applicazione usa.

Node non riesce a eseguirlo. Non per i tipi — Node 24 li rimuove da solo — ma
per **come vengono risolti gli import**:

```
Error [ERR_MODULE_NOT_FOUND]:
  Cannot find module 'src/connectors/seed/generate'
  imported from 'src/connectors/seed/index.ts'
```

Il progetto usa `"moduleResolution": "bundler"` in `tsconfig.json`, che permette
`import { x } from "./generate"` senza estensione. È la convenzione di Next.js e
di Vitest, entrambi dotati di un proprio risolutore. Node invece richiede
`"./generate.ts"` esplicito, come impone la specifica dei moduli ES.

Le due cose sono incompatibili per costruzione, non per configurazione.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| A — `tsx` come dipendenza di sviluppo | uno strumento, nessuna modifica al codice; già presente nell'albero | dipendenza fuori dalla tabella di §3 |
| B — Estensioni `.ts` esplicite ovunque in `src` | nessuna dipendenza | tocca ogni file del progetto, va contro le convenzioni di Next.js, e richiede `allowImportingTsExtensions` |
| C — Eseguire lo script con Vitest | nessuna dipendenza nuova | un runner di test che carica dati in produzione: l'uso sbagliato dello strumento sbagliato |
| D — Route HTTP di sviluppo dentro l'applicazione | risolto dal bundler di Next | codice applicativo per un'operazione da riga di comando, e una route che scrive dati va protetta |

## Decisione

**Opzione A.** `tsx` entra fra le dipendenze di sviluppo, e `npm run seed` lo usa.

## Motivazione

`tsx` **è già installato**: drizzle-kit lo porta con sé. Dichiararlo non aggiunge
nulla all'installazione — cambia solo che smette di essere un dettaglio
implementativo di un'altra libreria, su cui il progetto non ha voce.

Un pacchetto presente ma non dichiarato è una dipendenza reale con la garanzia di
una coincidenza: il giorno in cui drizzle-kit cambia i propri requisiti,
`npm run seed` si rompe per una ragione che non compare da nessuna parte.

L'opzione B è quella "senza dipendenze", ma il costo è sproporzionato: toccare
ogni import di `src` per far girare uno script di sviluppo significa piegare il
codice applicativo alle esigenze di un utensile.

## Conseguenze

**Positive**
- Gli script di sviluppo possono importare il codice applicativo così com'è.
- Vale anche per gli script futuri: migrazioni di dati, esportazioni, diagnostica.

**Negative / costi accettati**
- Una voce in più fra le dipendenze di sviluppo.
- Due modi di eseguire TypeScript nel progetto: `tsx` per gli script, il
  bundler per l'applicazione. Vanno a rimanere allineati sulla versione di
  TypeScript.

**Vincoli che ne derivano**
- `tsx` resta **solo** fra le dipendenze di sviluppo: non entra mai nel codice
  che viene distribuito.
- Gli script che non importano `src` restano in `.mjs` semplice ed eseguiti da
  Node: `check-env.mjs`, `generate-secrets.mjs`, `check-boundaries.mjs`. Nessuno
  di loro ha ragione di dipendere da uno strumento in più.

## Quando riconsiderare

Se Node acquisisse una risoluzione compatibile con quella dei bundler, oppure se
il progetto passasse a estensioni esplicite per altri motivi, la dipendenza
diventerebbe superflua e andrebbe rimossa.
