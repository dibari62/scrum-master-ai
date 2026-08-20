import { describe, expect, it } from "vitest";

import {
  PASSWORD_MIN_LENGTH,
  signInInputSchema,
  signUpInputSchema,
  slugify,
} from "@/domain";

const VALID_SIGN_UP = {
  organizationName: "Acme S.p.A.",
  organizationSlug: "acme",
  name: "Giulia Rossi",
  email: "giulia.rossi@example.it",
  password: "cavallo-batteria-graffetta",
} as const;

describe("signUpInputSchema", () => {
  it("accetta una registrazione completa e normalizza indirizzo e slug", () => {
    const input = signUpInputSchema.parse({
      ...VALID_SIGN_UP,
      organizationSlug: "  ACME  ",
      email: "Giulia.Rossi@Example.IT",
    });

    expect(input.organizationSlug).toBe("acme");
    expect(input.email).toBe("giulia.rossi@example.it");
  });

  it("rifiuta una password più corta della soglia", () => {
    const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(signUpInputSchema.safeParse({ ...VALID_SIGN_UP, password: short }).success).toBe(
      false,
    );
  });

  it("accetta una password lunga esattamente quanto la soglia", () => {
    const exact = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(signUpInputSchema.safeParse({ ...VALID_SIGN_UP, password: exact }).success).toBe(
      true,
    );
  });

  it("rifiuta uno slug non valido invece di correggerlo in silenzio", () => {
    expect(
      signUpInputSchema.safeParse({ ...VALID_SIGN_UP, organizationSlug: "acme spa!" }).success,
    ).toBe(false);
  });
});

describe("signInInputSchema", () => {
  it("non applica la politica di lunghezza", () => {
    // Un account creato prima di un irrigidimento della politica deve poter
    // ancora accedere, e rispondere "troppo corta" a un tentativo di accesso
    // confermerebbe che l'indirizzo esiste.
    const result = signInInputSchema.safeParse({
      email: "giulia.rossi@example.it",
      password: "corta",
    });

    expect(result.success).toBe(true);
  });

  it("rifiuta comunque una password vuota", () => {
    expect(
      signInInputSchema.safeParse({ email: "giulia.rossi@example.it", password: "" }).success,
    ).toBe(false);
  });
});

describe("slugify", () => {
  it.each([
    ["Acme S.p.A.", "acme-s-p-a"],
    ["Città di Bari", "citta-di-bari"],
    ["  Checkout 2026  ", "checkout-2026"],
    ["Già-Fatto", "gia-fatto"],
  ])("trasforma %s in %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("produce un suggerimento, non una garanzia: il risultato passa comunque da slugSchema", () => {
    // Un nome fatto di soli caratteri non trasformabili non può produrre uno
    // slug valido: deve fallire la validazione, non passare come stringa vuota.
    const suggestion = slugify("!!!");
    expect(suggestion).toBe("");
    expect(
      signUpInputSchema.safeParse({ ...VALID_SIGN_UP, organizationSlug: suggestion }).success,
    ).toBe(false);
  });
});
