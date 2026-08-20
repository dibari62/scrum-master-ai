# ADR-0006 — Autenticazione: Auth.js con sessione JWT e adapter Drizzle

- **Stato:** proposto
- **Data:** 2026-08-20
- **Decisori:** Giuseppe Di Bari

## Contesto

T0 richiede registrazione e accesso. `AGENTS.md` §3 indica Auth.js con «credenziali +
GitHub OAuth», ma non dice **come** si persistono utenti e collegamenti OAuth, né dove
vive la sessione. Sono due scelte che toccano la forma della tabella `users` e
introducono dipendenze: vanno decise in chiaro (§10.2).

Tre vincoli del contesto pesano sulla scelta:

1. **Neon Free va in scale-to-zero.** Ogni interrogazione aggiuntiva sul percorso di
   ogni richiesta può incontrare un cold start di centinaia di millisecondi.
2. **Il collegamento fra account OAuth e account esistenti è un vettore di attacco.**
   Se un fornitore restituisce un indirizzo non verificato e il sistema lo collega
   automaticamente a un account già presente, chiunque possa impostare quell'indirizzo
   presso il fornitore prende il controllo dell'account.
3. **`Membership` è la sorgente dell'autorizzazione** (§8.4): la sessione deve sapere
   su quale organizzazione l'utente sta operando.

## Opzioni considerate

### Dove vive la sessione

| Opzione | Pro | Contro |
|---|---|---|
| A — Sessione JWT | nessuna interrogazione al database per richiesta | revoca non immediata: un token resta valido fino alla scadenza |
| B — Sessione su database | revoca immediata | una lettura per ogni richiesta, con il cold start di Neon in mezzo |

**Il provider a credenziali di Auth.js funziona solo con sessione JWT.** L'opzione B è
quindi incompatibile con il requisito «credenziali» di §3: la scelta è obbligata, non
preferita.

### Come si persistono utenti e account OAuth

| Opzione | Pro | Contro |
|---|---|---|
| C — `@auth/drizzle-adapter` | percorso ufficiale; niente collegamento automatico per indirizzo, che è il comportamento sicuro predefinito | dipendenza fuori dalla tabella di §3; impone la forma di `users` e `accounts` |
| D — Persistenza scritta a mano nel callback `signIn` | nessuna dipendenza, tabelle come le vogliamo | il collegamento fra account va implementato da noi, ed è codice di sicurezza |

### Come si sceglie l'algoritmo di hashing della password

| Opzione | Pro | Contro |
|---|---|---|
| E — `scrypt` di `node:crypto` | libreria standard, nessuna dipendenza, funzione memory-hard progettata per le password | parametri da scegliere e documentare |
| F — `bcrypt` / `argon2` | diffusi, parametri noti | dipendenza nativa da compilare; fuori dalla tabella di §3 |

## Decisione

- **Sessione JWT** (opzione A), imposta dal provider a credenziali.
- **`@auth/drizzle-adapter`** per utenti e account OAuth (opzione C).
- **`scrypt` di `node:crypto`** per le password (opzione E), con i parametri incorporati
  nella stringa memorizzata.
- Le credenziali stanno in una tabella `user_credentials` separata, **non** su `users`.
- Il token porta `userId`, `organizationId` e `role`.

## Motivazione

**Sull'adapter.** La regola di §3 dice di non introdurre dipendenze fuori tabella senza
un ADR, e in caso di dubbio di scrivere venti righe proprie. Qui le venti righe proprie
sarebbero codice di collegamento fra account: la parte in cui un errore non si manifesta
come malfunzionamento ma come presa di controllo silenziosa di un account. Auth.js
rifiuta di collegare automaticamente un account OAuth a un utente esistente con lo stesso
indirizzo, e restituisce `OAuthAccountNotLinked`. Ottenere quel comportamento gratis vale
la dipendenza; è anche il pacchetto ufficiale della libreria già approvata in §3.

**Su scrypt.** È l'unica funzione memory-hard presente nella libreria standard di Node.
Evita una dipendenza nativa da compilare su Vercel e non richiede fiducia in un pacchetto
di terze parti per la parte più delicata del sistema. I parametri (`N`, `r`, `p`) sono
salvati **dentro** la stringa dell'hash: si possono irrobustire domani senza invalidare
le password già registrate.

**Sulle credenziali separate da `users`.** Un `passwordHash` su `users` viaggia con
l'entità ogni volta che viene serializzata verso l'interfaccia. Una tabella separata
rende l'errore impossibile invece che improbabile — la stessa ragione per cui `User` in
`src/domain` non ha quel campo.

**Sul tenant nel token.** L'alternativa è leggere `memberships` a ogni richiesta, che è
esattamente l'interrogazione per richiesta che l'opzione A esiste per evitare.

## Conseguenze

**Positive**
- Nessuna lettura sul database per validare una sessione.
- Il collegamento fra account OAuth segue il comportamento sicuro predefinito di Auth.js.
- Nessuna dipendenza nativa: il deploy su Vercel resta banale.

**Negative / costi accettati**
- **La revoca non è immediata.** Rimuovere una `Membership` non invalida i token già
  emessi: l'accesso cade alla scadenza. Accettabile in un proof-of-concept, **non**
  accettabile in produzione senza una lista di revoca o un controllo sulle operazioni
  sensibili. Va riaperto prima di qualunque uso reale.
- `users` acquisisce due campi che servono solo all'adapter: `emailVerified` (nome
  imposto) e `image`.
- Un utente appartenente a più organizzazioni deve cambiare organizzazione attiva con
  un'azione esplicita che riemette il token.

**Vincoli che ne derivano per il codice**
- Nessun componente legge `passwordHash`: solo `src/lib/auth` interroga `user_credentials`.
- La verifica di una password è sempre a tempo costante, anche quando l'utente non
  esiste, altrimenti il tempo di risposta rivela quali indirizzi sono registrati.
- La ricerca di un utente per indirizzo **non** passa dallo scope per organizzazione di
  §8.4: al momento dell'accesso il tenant non è ancora noto. `users` non è una tabella di
  dominio e non ha `organization_id`.

## Quando riconsiderare

- Alla prima esigenza di revoca immediata di un accesso → sessione su database o lista
  di revoca.
- Se servisse un secondo fornitore OAuth con indirizzi non verificati → rivedere la
  politica di collegamento fra account.
