import { describe, expect, it } from "vitest";

import {
  descriptionSchema,
  displayNameSchema,
  emailSchema,
  slugSchema,
  timestampSchema,
} from "@/domain";

describe("timestampSchema", () => {
  it("lascia passare un Date invariato", () => {
    const instant = new Date("2026-03-14T09:30:00.000Z");
    expect(timestampSchema.parse(instant)).toEqual(instant);
  });

  it("converte una stringa ISO in Date", () => {
    const parsed = timestampSchema.parse("2026-03-14T09:30:00.000Z");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toISOString()).toBe("2026-03-14T09:30:00.000Z");
  });

  it("accetta un offset esplicito e lo normalizza in UTC", () => {
    const parsed = timestampSchema.parse("2026-03-14T10:30:00.000+01:00");
    expect(parsed.toISOString()).toBe("2026-03-14T09:30:00.000Z");
  });

  it("rifiuta una data non valida invece di produrre Invalid Date", () => {
    expect(timestampSchema.safeParse("ieri").success).toBe(false);
    expect(timestampSchema.safeParse("2026-03-14").success).toBe(false);
  });

  it("rifiuta i valori che la coercizione accetterebbe per sbaglio", () => {
    // `new Date(true)` e `new Date(0)` sono date valide: è il motivo per cui
    // questo schema non usa z.coerce.date().
    expect(timestampSchema.safeParse(true).success).toBe(false);
    expect(timestampSchema.safeParse(0).success).toBe(false);
  });
});

describe("displayNameSchema", () => {
  it("rimuove gli spazi ai bordi", () => {
    expect(displayNameSchema.parse("  Acme S.p.A.  ")).toBe("Acme S.p.A.");
  });

  it("rifiuta una stringa di soli spazi", () => {
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rifiuta un nome oltre i 120 caratteri", () => {
    expect(displayNameSchema.safeParse("a".repeat(121)).success).toBe(false);
  });
});

describe("slugSchema", () => {
  it("normalizza in minuscolo e rimuove gli spazi ai bordi", () => {
    expect(slugSchema.parse("  Checkout-2026  ")).toBe("checkout-2026");
  });

  it.each([
    ["-checkout", "trattino iniziale"],
    ["checkout-", "trattino finale"],
    ["check--out", "trattino doppio"],
    ["check out", "spazio interno"],
    ["check_out", "underscore"],
    ["c", "troppo corto"],
    ["a".repeat(49), "troppo lungo"],
  ])("rifiuta %s (%s)", (value) => {
    expect(slugSchema.safeParse(value).success).toBe(false);
  });

  it("accetta cifre e gruppi separati da trattini singoli", () => {
    expect(slugSchema.parse("team-alpha-2")).toBe("team-alpha-2");
  });
});

describe("emailSchema", () => {
  it("normalizza in minuscolo, così un indirizzo corrisponde a un solo account", () => {
    expect(emailSchema.parse("  Giulia.Rossi@Example.IT ")).toBe("giulia.rossi@example.it");
  });

  it("rifiuta un indirizzo malformato", () => {
    expect(emailSchema.safeParse("giulia.rossi@").success).toBe(false);
    expect(emailSchema.safeParse("non-un-indirizzo").success).toBe(false);
  });
});

describe("descriptionSchema", () => {
  it("ammette null per l'assenza di testo", () => {
    expect(descriptionSchema.parse(null)).toBeNull();
  });

  it("rifiuta un testo oltre i 2000 caratteri", () => {
    expect(descriptionSchema.safeParse("a".repeat(2001)).success).toBe(false);
  });
});
