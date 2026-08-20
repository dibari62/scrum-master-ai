import type { Query } from "drizzle-orm";
import { describe, expect, it, vi, type MockInstance } from "vitest";

import { createDatabase, type Database } from "@/db";
import { signUpInputSchema } from "@/domain";
import { classifyRegistrationError, registerOrganization } from "@/lib/auth/registration";
import { verifyPassword } from "@/lib/password";

const CONNECTION = "postgresql://user:password@ep-example-123.eu-central-1.aws.neon.tech/neondb";

const SIGN_UP = signUpInputSchema.parse({
  organizationName: "Acme S.p.A.",
  organizationSlug: "acme",
  name: "Giulia Rossi",
  email: "giulia.rossi@example.it",
  password: "cavallo-batteria-graffetta",
});

/** Shape of a Postgres unique violation as the driver reports it. */
function uniqueViolation(constraint: string): object {
  return {
    code: "23505",
    constraint,
    message: `duplicate key value violates unique constraint "${constraint}"`,
  };
}

/**
 * Compiles the statements handed to `batch`.
 *
 * `BatchItem` does not advertise `toSQL` in its type even though every builder
 * implements it, so the narrowing happens here once, explicitly, instead of
 * being asserted away at each call site.
 */
function compile(statements: unknown): ReadonlyArray<Query> {
  if (!Array.isArray(statements)) {
    throw new Error("batch non ha ricevuto un elenco di istruzioni");
  }

  return statements.map((statement: unknown) => {
    if (typeof statement !== "object" || statement === null || !("toSQL" in statement)) {
      throw new Error("istruzione priva di toSQL");
    }

    const { toSQL } = statement as { toSQL: unknown };
    if (typeof toSQL !== "function") throw new Error("toSQL non è una funzione");

    return toSQL.call(statement) as Query;
  });
}

function captured(batch: MockInstance<Database["batch"]>): ReadonlyArray<Query> {
  return compile(batch.mock.calls[0]?.[0]);
}

describe("classifyRegistrationError", () => {
  it("riconosce uno slug di organizzazione già in uso", () => {
    expect(classifyRegistrationError(uniqueViolation("organizations_slug_unique"))).toBe(
      "organization-slug-taken",
    );
  });

  it("riconosce un indirizzo già registrato", () => {
    expect(classifyRegistrationError(uniqueViolation("users_email_unique"))).toBe(
      "email-taken",
    );
  });

  it("riconosce il vincolo anche quando arriva solo nel messaggio", () => {
    expect(
      classifyRegistrationError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "users_email_unique"',
      }),
    ).toBe("email-taken");
  });

  it.each([
    ["errore non di unicità", { code: "23503", constraint: "users_email_unique" }],
    ["vincolo sconosciuto", uniqueViolation("qualcosa_altro")],
    ["errore generico", new Error("connessione interrotta")],
    ["valore non oggetto", "boom"],
    ["null", null],
  ])("non classifica %s", (_name, error) => {
    expect(classifyRegistrationError(error)).toBeNull();
  });
});

describe("registerOrganization", () => {
  it("crea organizzazione, utente, credenziale e appartenenza in un unico batch", async () => {
    const db = createDatabase(CONNECTION);
    const batch = vi.spyOn(db, "batch").mockResolvedValue([] as never);

    const outcome = await registerOrganization(SIGN_UP, db);

    expect(outcome.ok).toBe(true);
    expect(batch).toHaveBeenCalledTimes(1);

    const statements = captured(batch);
    expect(statements).toHaveLength(4);

    const sql = statements.map((statement) => statement.sql).join("\n");
    expect(sql).toContain('"organizations"');
    expect(sql).toContain('"users"');
    expect(sql).toContain('"user_credentials"');
    expect(sql).toContain('"memberships"');
  });

  it("usa gli stessi identificatori in tutte e quattro le istruzioni", async () => {
    const db = createDatabase(CONNECTION);
    const batch = vi.spyOn(db, "batch").mockResolvedValue([] as never);

    const outcome = await registerOrganization(SIGN_UP, db);
    if (!outcome.ok) throw new Error("la registrazione doveva riuscire");

    const params = captured(batch).flatMap((statement) => statement.params);

    // L'appartenenza deve puntare all'organizzazione e all'utente appena creati:
    // se gli identificatori divergessero, la registrazione produrrebbe un utente
    // senza tenant e un'organizzazione senza proprietario.
    expect(params.filter((value) => value === outcome.organizationId)).toHaveLength(2);
    expect(params.filter((value) => value === outcome.userId)).toHaveLength(3);
  });

  it("registra il proprietario come owner", async () => {
    const db = createDatabase(CONNECTION);
    const batch = vi.spyOn(db, "batch").mockResolvedValue([] as never);

    await registerOrganization(SIGN_UP, db);

    const params = captured(batch).flatMap((statement) => statement.params);

    expect(params).toContain("owner");
  });

  it("non fa mai arrivare la password in chiaro al database", async () => {
    const db = createDatabase(CONNECTION);
    const batch = vi.spyOn(db, "batch").mockResolvedValue([] as never);

    await registerOrganization(SIGN_UP, db);

    const params = captured(batch).flatMap((statement) => statement.params);

    expect(params).not.toContain(SIGN_UP.password);

    const hash = params.find(
      (value) => typeof value === "string" && value.startsWith("scrypt$"),
    );
    expect(hash).toBeTypeOf("string");
    await expect(verifyPassword(SIGN_UP.password, String(hash))).resolves.toBe(true);
  });

  it("traduce una collisione in un esito tipizzato invece di propagare l'errore", async () => {
    const db = createDatabase(CONNECTION);
    vi.spyOn(db, "batch").mockRejectedValue(uniqueViolation("users_email_unique"));

    const outcome = await registerOrganization(SIGN_UP, db);

    expect(outcome).toEqual({ ok: false, reason: "email-taken" });
  });

  it("rilancia un errore che non sa spiegare, invece di travestirlo", async () => {
    const db = createDatabase(CONNECTION);
    vi.spyOn(db, "batch").mockRejectedValue(new Error("connessione interrotta"));

    await expect(registerOrganization(SIGN_UP, db)).rejects.toThrow("connessione interrotta");
  });
});
