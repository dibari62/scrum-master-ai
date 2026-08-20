import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, forOrganization, type Database } from "@/db";
import { memberships, organizations, userCredentials, users } from "@/db/schema";
import {
  projectIdSchema,
  signUpInputSchema,
  type OrganizationId,
  type UserId,
} from "@/domain";
import { registerOrganization } from "@/lib/auth/registration";
import { verifyPassword } from "@/lib/password";

/**
 * Isolation between two organizations, against a real Postgres.
 *
 * `tests/db/tenant-isolation.test.ts` proves that no statement leaves the
 * tenant scope without its organization. That is a property of the SQL we
 * generate; it says nothing about how the server behaves once the rows are
 * actually there. This file closes the other half of AGENTS.md §8.4.
 *
 * Opt-in through `RUN_DB_INTEGRATION=1`, not merely "a database URL exists":
 * these tests write and delete rows, and `npm run test` must never do that to
 * whatever database a developer happens to have configured. `npm run verify`
 * therefore stays independent of any database, and so does CI.
 *
 * Behind a TLS-inspecting proxy, run node with `--use-system-ca`.
 */

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const CONNECTION = process.env["DATABASE_URL"];
const ENABLED = process.env["RUN_DB_INTEGRATION"] === "1" && Boolean(CONNECTION);

/** Fictional people and companies only (§8.2), on a reserved domain. */
const RUN = randomBytes(4).toString("hex");
const PASSWORD = "cavallo-batteria-graffetta";

function signUp(company: string, person: string, mailbox: string) {
  return signUpInputSchema.parse({
    organizationName: `${company} ${RUN}`,
    organizationSlug: `${company}-${RUN}`,
    name: person,
    email: `${mailbox}-${RUN}@example.invalid`,
    password: PASSWORD,
  });
}

const ACME = signUp("acme", "Giulia Rossi", "giulia");
const BOREALIS = signUp("borealis", "Marco Bianchi", "marco");

describe.skipIf(!ENABLED)("isolamento fra organizzazioni su Postgres reale", () => {
  let db: Database;
  let acmeId: OrganizationId;
  let acmeUserId: UserId;
  let borealisId: OrganizationId;
  let borealisUserId: UserId;

  beforeAll(async () => {
    db = createDatabase(CONNECTION as string);

    const acme = await registerOrganization(ACME, db);
    if (!acme.ok) throw new Error(`registrazione Acme fallita: ${acme.reason}`);
    acmeId = acme.organizationId;
    acmeUserId = acme.userId;

    const borealis = await registerOrganization(BOREALIS, db);
    if (!borealis.ok) throw new Error(`registrazione Borealis fallita: ${borealis.reason}`);
    borealisId = borealis.organizationId;
    borealisUserId = borealis.userId;
  });

  afterAll(async () => {
    // Organizations cascade to memberships and projects, users to credentials.
    for (const id of [acmeId, borealisId]) {
      if (id) await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of [acmeUserId, borealisUserId]) {
      if (id) await db.delete(users).where(eq(users.id, id));
    }
  });

  it("la registrazione crea organizzazione, utente, credenziale e appartenenza", async () => {
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, acmeId));
    const [user] = await db.select().from(users).where(eq(users.id, acmeUserId));
    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, acmeUserId));
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, acmeUserId));

    expect(organization?.slug).toBe(ACME.organizationSlug);
    expect(user?.email).toBe(ACME.email);
    expect(credential).toBeDefined();
    expect(membership?.role).toBe("owner");
    expect(membership?.organizationId).toBe(acmeId);
  });

  it("memorizza un verificatore, non la password", async () => {
    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, acmeUserId));

    const hash = credential?.passwordHash ?? "";
    expect(hash).not.toContain(PASSWORD);
    expect(hash.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it("rifiuta un secondo account con lo stesso indirizzo", async () => {
    const duplicate = await registerOrganization(
      signUpInputSchema.parse({ ...ACME, organizationSlug: `altra-${RUN}` }),
      db,
    );

    expect(duplicate).toEqual({ ok: false, reason: "email-taken" });
  });

  it("rifiuta una seconda azienda con lo stesso identificativo", async () => {
    const duplicate = await registerOrganization(
      signUpInputSchema.parse({ ...ACME, email: `altra-${RUN}@example.invalid` }),
      db,
    );

    expect(duplicate).toEqual({ ok: false, reason: "organization-slug-taken" });
  });

  // Il cuore del file: due organizzazioni reali, righe reali, e la prova che
  // nessuna delle due vede i dati dell'altra passando dallo scope condiviso.
  it("lo scope di un'organizzazione non vede i progetti dell'altra", async () => {
    const acme = forOrganization(db, acmeId);
    const borealis = forOrganization(db, borealisId);

    await acme.writes.createProject({
      name: "Checkout",
      slug: "checkout",
      description: null,
    });
    await borealis.writes.createProject({
      name: "Checkout",
      slug: "checkout",
      description: null,
    });

    const acmeProjects = await acme.reads.projects();
    const borealisProjects = await borealis.reads.projects();

    expect(acmeProjects).toHaveLength(1);
    expect(borealisProjects).toHaveLength(1);
    expect(acmeProjects[0]?.organizationId).toBe(acmeId);
    expect(borealisProjects[0]?.organizationId).toBe(borealisId);
  });

  it("lo stesso slug di progetto convive in due organizzazioni", async () => {
    // Un vincolo di unicità globale farebbe trapelare l'esistenza del progetto
    // di un'altra azienda attraverso un errore di conflitto.
    const [found] = await forOrganization(db, acmeId).reads.projectBySlug("checkout");

    expect(found?.organizationId).toBe(acmeId);
  });

  it("cercare per identificativo un progetto altrui non restituisce nulla", async () => {
    const [borealisProject] = await forOrganization(db, borealisId).reads.projects();
    if (!borealisProject) throw new Error("progetto di Borealis mancante");

    const stolen = await forOrganization(db, acmeId).reads.projectById(
      projectIdSchema.parse(borealisProject.id),
    );

    expect(stolen).toHaveLength(0);
  });

  it("un'organizzazione non vede le appartenenze dell'altra", async () => {
    const acme = forOrganization(db, acmeId);

    const own = await acme.reads.memberships();
    expect(own).toHaveLength(1);
    expect(own[0]?.userId).toBe(acmeUserId);

    const foreign = await acme.reads.membershipByUserId(borealisUserId);
    expect(foreign).toHaveLength(0);
  });
});
