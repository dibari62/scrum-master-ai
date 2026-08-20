import { describe, expect, it } from "vitest";

import { isRedirectError } from "@/app/(auth)/redirect-error";

/**
 * Il controllo protegge il percorso di successo: Auth.js segnala un accesso
 * riuscito lanciando il reindirizzamento. Se questa funzione smettesse di
 * riconoscerlo, un accesso corretto verrebbe mostrato come fallito.
 */
describe("isRedirectError", () => {
  it.each([
    ["reindirizzamento semplice", "NEXT_REDIRECT"],
    ["reindirizzamento con destinazione", "NEXT_REDIRECT;replace;/organizzazione;307;"],
  ])("riconosce %s", (_name, digest) => {
    expect(isRedirectError(Object.assign(new Error("redirect"), { digest }))).toBe(true);
  });

  it.each([
    ["errore senza digest", new Error("credenziali non valide")],
    ["digest di un altro tipo", Object.assign(new Error("x"), { digest: "NEXT_NOT_FOUND" })],
    ["digest non testuale", Object.assign(new Error("x"), { digest: 42 })],
    ["oggetto semplice", {}],
    ["null", null],
    ["stringa", "NEXT_REDIRECT"],
  ])("non scambia %s per un reindirizzamento", (_name, error) => {
    expect(isRedirectError(error)).toBe(false);
  });
});
