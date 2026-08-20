import { describe, expect, it } from "vitest";

import {
  SIGN_IN_FAILURE_MESSAGE,
  parseSignInForm,
  parseSignUpForm,
  readFields,
  registrationFailureState,
  signInFailureState,
} from "@/app/(auth)/form-state";

function formOf(values: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.append(name, value);
  return form;
}

const VALID_SIGN_UP = {
  organizationName: "Acme S.p.A.",
  organizationSlug: "acme",
  name: "Giulia Rossi",
  email: "giulia.rossi@example.it",
  password: "cavallo-batteria-graffetta",
} as const;

describe("readFields", () => {
  it("restituisce stringa vuota per un campo assente", () => {
    expect(readFields(formOf({ email: "a@b.it" }), ["email", "password"])).toEqual({
      email: "a@b.it",
      password: "",
    });
  });

  it("non lascia passare un valore non testuale", () => {
    const form = new FormData();
    form.append("email", new File([""], "trojan.txt"));

    expect(readFields(form, ["email"])).toEqual({ email: "" });
  });
});

describe("parseSignUpForm", () => {
  it("accetta una registrazione valida e restituisce i valori normalizzati", () => {
    const result = parseSignUpForm(
      formOf({ ...VALID_SIGN_UP, organizationSlug: "  ACME ", email: "Giulia@Example.IT" }),
    );

    if (!result.ok) throw new Error("il modulo doveva essere valido");
    expect(result.data.organizationSlug).toBe("acme");
    expect(result.data.email).toBe("giulia@example.it");
  });

  it("segnala l'errore sul campo che lo ha causato", () => {
    const result = parseSignUpForm(formOf({ ...VALID_SIGN_UP, password: "corta" }));

    if (result.ok) throw new Error("il modulo doveva essere invalido");
    if (result.state.status !== "invalid") throw new Error("stato inatteso");
    expect(Object.keys(result.state.errors.fields)).toEqual(["password"]);
  });

  it("non rimanda mai indietro la password", () => {
    const result = parseSignUpForm(formOf({ ...VALID_SIGN_UP, email: "non-valido" }));

    if (result.ok) throw new Error("il modulo doveva essere invalido");
    if (result.state.status !== "invalid") throw new Error("stato inatteso");
    expect(result.state.values.password).toBe("");
    // Gli altri campi restano, altrimenti l'utente riscrive tutto da capo.
    expect(result.state.values.organizationName).toBe(VALID_SIGN_UP.organizationName);
  });

  it("tiene un solo messaggio per campo", () => {
    const result = parseSignUpForm(
      formOf({ organizationName: "", organizationSlug: "", name: "", email: "", password: "" }),
    );

    if (result.ok) throw new Error("il modulo doveva essere invalido");
    if (result.state.status !== "invalid") throw new Error("stato inatteso");
    for (const message of Object.values(result.state.errors.fields)) {
      expect(message).not.toContain("\n");
    }
  });
});

describe("parseSignInForm", () => {
  it("accetta una password corta: la politica vale solo alla registrazione", () => {
    const result = parseSignInForm(formOf({ email: "giulia@example.it", password: "corta" }));
    expect(result.ok).toBe(true);
  });

  it("rifiuta una password vuota", () => {
    const result = parseSignInForm(formOf({ email: "giulia@example.it", password: "" }));
    expect(result.ok).toBe(false);
  });
});

describe("registrationFailureState", () => {
  it.each([
    ["organization-slug-taken", "organizationSlug"],
    ["email-taken", "email"],
  ] as const)("attribuisce %s al campo %s", (reason, field) => {
    const state = registrationFailureState(reason, { ...VALID_SIGN_UP });

    if (state.status !== "invalid") throw new Error("stato inatteso");
    expect(Object.keys(state.errors.fields)).toEqual([field]);
    expect(state.values.password).toBe("");
  });
});

describe("signInFailureState", () => {
  it("non rivela quale dei due campi è sbagliato", () => {
    const state = signInFailureState({ email: "giulia@example.it", password: "sbagliata" });

    if (state.status !== "invalid") throw new Error("stato inatteso");
    expect(state.errors.fields).toEqual({});
    expect(state.errors.summary).toBe(SIGN_IN_FAILURE_MESSAGE);
  });

  it("non nomina né l'indirizzo né l'esistenza dell'account", () => {
    expect(SIGN_IN_FAILURE_MESSAGE.toLowerCase()).not.toContain("non esiste");
    expect(SIGN_IN_FAILURE_MESSAGE.toLowerCase()).not.toContain("registrat");
  });
});
