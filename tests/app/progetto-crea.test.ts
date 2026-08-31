import { describe, expect, it } from "vitest";

import {
  CREATE_PROJECT_FIELDS,
  creationFailureState,
  parseCreateProjectForm,
  RESERVED_PROJECT_SLUGS,
} from "@/app/progetti/crea/form-state";
import { slugSchema, slugify } from "@/domain";

/**
 * Validation of the project form, and the identifier it proposes.
 *
 * The server action itself cannot be tested — its identifier is generated at
 * build time — so everything it decides lives in the functions below, and this
 * is where those decisions are checked. What the browser does with them is the
 * subject of `tests-e2e/progetto-crea.spec.ts`.
 */

function formOf(values: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.append(name, value);
  return form;
}

const VALID = {
  name: "Piattaforma di checkout",
  slug: "piattaforma-di-checkout",
  description: "Il flusso di pagamento del negozio.",
} as const;

function errorsOf(form: FormData): Readonly<Record<string, string>> {
  const parsed = parseCreateProjectForm(form);
  if (parsed.ok) throw new Error("il modulo doveva essere rifiutato");
  if (parsed.state.status !== "invalid") throw new Error("stato inatteso");

  return parsed.state.errors.fields;
}

describe("parseCreateProjectForm", () => {
  it("accetta un progetto completo", () => {
    const parsed = parseCreateProjectForm(formOf(VALID));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data).toEqual({
      name: "Piattaforma di checkout",
      slug: "piattaforma-di-checkout",
      description: "Il flusso di pagamento del negozio.",
    });
  });

  it("tratta una descrizione vuota come assente, non come stringa vuota", () => {
    const parsed = parseCreateProjectForm(formOf({ ...VALID, description: "   " }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // `null` e `""` direbbero la stessa cosa in due modi: il dominio ne ammette
    // uno solo, così nessun lettore a valle deve gestirli entrambi.
    expect(parsed.data.description).toBeNull();
  });

  it("normalizza l'identificativo invece di rifiutarlo per un maiuscolo", () => {
    const parsed = parseCreateProjectForm(formOf({ ...VALID, slug: "  Checkout  " }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data.slug).toBe("checkout");
  });

  it("segnala il nome mancante sul proprio campo", () => {
    expect(errorsOf(formOf({ ...VALID, name: "   " }))).toHaveProperty("name");
  });

  it.each([
    ["spazi", "piattaforma di checkout"],
    ["maiuscole con simboli", "Checkout!"],
    ["trattino doppio", "checkout--2026"],
    ["trattino iniziale", "-checkout"],
    ["trattino finale", "checkout-"],
    ["troppo corto", "c"],
  ])("rifiuta un identificativo con %s e lo dice sul campo dello slug", (_case, slug) => {
    const errors = errorsOf(formOf({ ...VALID, slug }));

    expect(errors).toHaveProperty("slug");
    expect(errors).not.toHaveProperty("name");
  });

  it("rifiuta un identificativo riservato all'applicazione", () => {
    /*
     * `/progetti/crea` è un segmento fisso e ha la precedenza su
     * `/progetti/[slug]`: un progetto con questo identificativo comparirebbe
     * nell'elenco e aprirebbe il modulo di creazione quando lo si clicca.
     */
    for (const reserved of RESERVED_PROJECT_SLUGS) {
      expect(errorsOf(formOf({ ...VALID, slug: reserved }))).toHaveProperty("slug");
    }
  });

  it("rifiuta anche la forma non normalizzata di un identificativo riservato", () => {
    expect(errorsOf(formOf({ ...VALID, slug: " Crea " }))).toHaveProperty("slug");
  });

  it("restituisce i valori inviati, così il modulo non si svuota", () => {
    const parsed = parseCreateProjectForm(formOf({ ...VALID, slug: "non valido" }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    if (parsed.state.status !== "invalid") throw new Error("stato inatteso");

    expect(parsed.state.values.name).toBe(VALID.name);
    expect(parsed.state.values.description).toBe(VALID.description);
  });

  it("non lascia passare un valore non testuale", () => {
    const form = formOf({ slug: VALID.slug, description: "" });
    form.append("name", new File([""], "trojan.txt"));

    expect(errorsOf(form)).toHaveProperty("name");
  });

  it("legge esattamente tre campi: l'organizzazione non arriva dal modulo", () => {
    // §8.4: un corpo di richiesta che potesse nominare un'organizzazione è la
    // forma esatta del difetto che l'isolamento fra aziende esiste per impedire.
    expect(CREATE_PROJECT_FIELDS).toEqual(["name", "slug", "description"]);
  });

  it("ignora un organizationId infilato nel modulo", () => {
    const parsed = parseCreateProjectForm(
      formOf({ ...VALID, organizationId: "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21" }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.data).not.toHaveProperty("organizationId");
  });
});

describe("identificativo proposto a partire dal nome", () => {
  it.each([
    ["Piattaforma di Checkout", "piattaforma-di-checkout"],
    ["Città Metropolitana", "citta-metropolitana"],
    ["  Checkout 2026  ", "checkout-2026"],
    ["Report & Analytics", "report-analytics"],
  ])("da «%s» propone «%s»", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it("propone sempre un identificativo che la validazione accetta", () => {
    // La proposta e la regola devono coincidere: un suggerimento che il modulo
    // poi rifiuta si legge come un difetto dell'applicazione, non del nome.
    for (const name of ["Piattaforma di Checkout", "Città Metropolitana", "App 2026"]) {
      expect(slugSchema.safeParse(slugify(name)).success).toBe(true);
    }
  });

  it("non finge di poter salvare un nome che non contiene lettere né cifre", () => {
    // Resta vuoto, e il modulo lo rifiuta sul campo: meglio di un
    // identificativo inventato che nessuno riconosce.
    expect(slugify("!!!")).toBe("");
    expect(slugSchema.safeParse("").success).toBe(false);
  });
});

describe("creationFailureState", () => {
  const values = { name: "Checkout", slug: "checkout", description: "" };

  it("mette un identificativo già in uso sul campo dello slug, non in cima al modulo", () => {
    const state = creationFailureState("slug-taken", values);
    if (state.status !== "invalid") throw new Error("stato inatteso");

    expect(state.errors.fields["slug"]).toBeTypeOf("string");
    expect(state.errors.summary).toBeNull();
    expect(state.values).toEqual(values);
  });

  it("mette un permesso mancante nel riepilogo, perché non è colpa di un campo", () => {
    const state = creationFailureState("forbidden", values);
    if (state.status !== "invalid") throw new Error("stato inatteso");

    expect(state.errors.fields).toEqual({});
    expect(state.errors.summary).toBeTypeOf("string");
  });

  it("non nomina un'altra azienda quando l'identificativo è già in uso", () => {
    const state = creationFailureState("slug-taken", values);
    if (state.status !== "invalid") throw new Error("stato inatteso");

    // Il vincolo è sulla coppia (organizzazione, slug), quindi la collisione è
    // sempre con un progetto della propria azienda: il messaggio lo dice, e non
    // può diventare un modo per scoprire i progetti di qualcun altro (§8.4).
    expect(state.errors.fields["slug"]).toContain("della tua azienda");
  });
});
