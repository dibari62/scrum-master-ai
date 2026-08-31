import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db";
import { organizationIdSchema, type CreateProjectInput } from "@/domain";
import {
  classifyProjectError,
  createProject,
  mayCreateProject,
} from "@/lib/projects/create";

/**
 * Creating a project: who may, and how a refused write is read.
 *
 * No database, not even a sleeping one. The only method this code path touches
 * is `insert`, so the double below provides that and nothing else: a test that
 * needed a connection string would be a test nobody can run offline, and the
 * decisions checked here have nothing to do with Postgres.
 */

const ORGANIZATION = organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21");

const PAYLOAD: CreateProjectInput = {
  name: "Piattaforma di checkout",
  slug: "checkout",
  description: null,
};

/** Shape of a Postgres unique violation as the driver reports it. */
function uniqueViolation(constraint: string): object {
  return {
    code: "23505",
    constraint,
    message: `duplicate key value violates unique constraint "${constraint}"`,
  };
}

/**
 * The same violation as Drizzle delivers it for a single statement.
 *
 * `db.insert(...)` wraps the driver's error in a `DrizzleQueryError` and keeps
 * the original in `cause`; `db.batch(...)` does not wrap. The first attempt at
 * this feature only understood the unwrapped form, so a duplicate identifier
 * produced a 500 page instead of a message on the field.
 */
function wrappedUniqueViolation(constraint: string): Error {
  const wrapper = new Error("Failed query: insert into \"projects\" ...");
  return Object.assign(wrapper, { cause: uniqueViolation(constraint) });
}

/**
 * A stand-in for the database, carrying only `insert`.
 *
 * The cast goes through `unknown` rather than `any`: it is a deliberate,
 * localised claim that this object is enough for this one call, not a hole in
 * the types that spreads.
 */
function databaseWith(insert: () => unknown): Database {
  return { insert } as unknown as Database;
}

/** A database whose awaited insert fails, so the catch path can be reached. */
function databaseThatFails(error: unknown): Database {
  return databaseWith(() => ({
    values: () => ({ returning: () => Promise.reject(error) }),
  }));
}

describe("mayCreateProject", () => {
  it.each(["owner", "admin"] as const)("%s può creare un progetto", (role) => {
    expect(mayCreateProject(role)).toBe(true);
  });

  /*
   * Deciso in modo restrittivo, come per la configurazione dello Scrum Master
   * AI: concedere un permesso dopo non disturba nessuno, toglierlo lo toglie a
   * chi aveva già cominciato a usarlo.
   */
  it("un membro non può", () => {
    expect(mayCreateProject("member")).toBe(false);
  });

  it.each([
    ["nessun ruolo", null],
    ["ruolo assente", undefined],
  ])("%s non basta", (_case, role) => {
    expect(mayCreateProject(role)).toBe(false);
  });
});

describe("classifyProjectError", () => {
  it("riconosce un identificativo già in uso nella stessa azienda", () => {
    expect(classifyProjectError(uniqueViolation("projects_organization_slug_key"))).toBe(
      "slug-taken",
    );
  });

  it("riconosce il vincolo anche quando arriva solo nel messaggio", () => {
    expect(
      classifyProjectError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "projects_organization_slug_key"',
      }),
    ).toBe("slug-taken");
  });

  it("riconosce il vincolo anche quando Drizzle avvolge l'errore del driver", () => {
    expect(classifyProjectError(wrappedUniqueViolation("projects_organization_slug_key"))).toBe(
      "slug-taken",
    );
  });

  it.each([
    ["errore non di unicità", { code: "23503", constraint: "projects_organization_slug_key" }],
    ["vincolo di un'altra tabella", uniqueViolation("organizations_slug_unique")],
    ["errore generico", new Error("connessione interrotta")],
    ["valore non oggetto", "boom"],
    ["null", null],
  ])("non classifica %s", (_case, error) => {
    expect(classifyProjectError(error)).toBeNull();
  });
});

describe("createProject", () => {
  it("rifiuta chi non ha il ruolo, e non tenta nemmeno la scrittura", async () => {
    const insert = vi.fn();

    const outcome = await createProject(
      { organizationId: ORGANIZATION, role: "member", payload: PAYLOAD },
      databaseWith(insert),
    );

    // Il controllo sta qui e non solo nell'interfaccia: un pulsante nascosto
    // non è un'autorizzazione.
    expect(outcome).toEqual({ ok: false, reason: "forbidden" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("traduce una collisione in un esito tipizzato invece di propagare l'errore", async () => {
    const db = databaseThatFails(uniqueViolation("projects_organization_slug_key"));

    await expect(
      createProject({ organizationId: ORGANIZATION, role: "owner", payload: PAYLOAD }, db),
    ).resolves.toEqual({ ok: false, reason: "slug-taken" });
  });

  it("traduce anche la collisione avvolta da Drizzle, che è quella reale dell'insert", async () => {
    const db = databaseThatFails(wrappedUniqueViolation("projects_organization_slug_key"));

    await expect(
      createProject({ organizationId: ORGANIZATION, role: "owner", payload: PAYLOAD }, db),
    ).resolves.toEqual({ ok: false, reason: "slug-taken" });
  });

  it("rilancia un errore che non sa spiegare, invece di travestirlo", async () => {
    const db = databaseThatFails(new Error("connessione interrotta"));

    // Riportare un guasto del database come «identificativo già in uso»
    // manderebbe chi legge a correggere la cosa sbagliata (§7).
    await expect(
      createProject({ organizationId: ORGANIZATION, role: "owner", payload: PAYLOAD }, db),
    ).rejects.toThrow("connessione interrotta");
  });

  it("non dichiara creato un progetto se la scrittura non restituisce la riga", async () => {
    const db = databaseWith(() => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }));

    // Un esito «ok» senza riga sarebbe una bugia che l'elenco smentisce un
    // istante dopo, ed è il tipo di incoerenza che chi guarda attribuisce
    // all'elenco.
    await expect(
      createProject({ organizationId: ORGANIZATION, role: "owner", payload: PAYLOAD }, db),
    ).rejects.toThrow(/non ha restituito alcuna riga/);
  });

  it("scrive un progetto valido e ne restituisce la forma canonica", async () => {
    const now = new Date("2026-08-25T10:00:00.000Z");
    const row = {
      id: "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905",
      organizationId: ORGANIZATION,
      name: PAYLOAD.name,
      slug: PAYLOAD.slug,
      description: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const values = vi.fn(() => ({ returning: () => Promise.resolve([row]) }));
    const db = databaseWith(() => ({ values }));

    const outcome = await createProject(
      { organizationId: ORGANIZATION, role: "owner", payload: PAYLOAD },
      db,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.project.slug).toBe("checkout");
    // Nasce attivo: l'archiviazione è un'azione separata e deliberata.
    expect(outcome.project.status).toBe("active");

    // L'organizzazione la mette lo scope nella riga scritta, non il payload (§8.4).
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
    expect(PAYLOAD).not.toHaveProperty("organizationId");
  });
});
