---
applyTo: "**/*.ts,**/*.tsx"
---

# Convenzioni TypeScript

- `strict` attivo. **`any` è vietato**: usa `unknown` seguito da narrowing con Zod.
- I tipi si **derivano** dagli schemi Zod con `z.infer`. Non riscrivere a mano una forma
  dati già dichiarata come schema.
- Identificatori e commenti in **inglese**. Testi rivolti all'utente in **italiano**.
- Niente `console.log` nel codice applicativo: usa il logger di `src/lib`.
- Nessun `catch` silenzioso: o gestisci l'errore, o lo rilanci arricchito di contesto.
- Preferisci `type` per le forme dati e `interface` solo per i contratti estendibili.
- Esporta il minimo indispensabile: ciò che non è esportato non va mantenuto stabile.
- Niente esportazioni di default, tranne dove Next.js le impone (pagine, layout, route).
- Le date sono `Date` in UTC; nessuna stringa di data non tipizzata in giro.
- Le funzioni che possono fallire restituiscono un esito esplicito, non `null` ambiguo.
- Commenta **solo** ciò che non è deducibile dal codice: l'invariante e il perché.
