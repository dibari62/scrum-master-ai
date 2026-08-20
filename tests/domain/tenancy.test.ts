import { describe, expect, it } from "vitest";

import {
  createMembershipInputSchema,
  createOrganizationInputSchema,
  createProjectInputSchema,
  membershipSchema,
  organizationSchema,
  projectSchema,
  roleAtLeast,
  updateProjectInputSchema,
  userSchema,
  type OrganizationRole,
} from "@/domain";

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const MEMBERSHIP_ID = "1b4e28ba-2fa1-4d3b-a3f5-cc9f8d3a1b77";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";

const AUDIT = {
  createdAt: "2026-03-01T08:00:00.000Z",
  updatedAt: "2026-03-02T08:00:00.000Z",
} as const;

describe("organizationSchema", () => {
  it("accetta un'organizzazione completa e normalizza lo slug", () => {
    const organization = organizationSchema.parse({
      id: ORGANIZATION_ID,
      name: "Acme S.p.A.",
      slug: "Acme",
      ...AUDIT,
    });

    expect(organization.slug).toBe("acme");
    expect(organization.createdAt).toBeInstanceOf(Date);
  });

  it("rifiuta un'organizzazione senza identificatore", () => {
    expect(
      organizationSchema.safeParse({ name: "Acme", slug: "acme", ...AUDIT }).success,
    ).toBe(false);
  });
});

describe("createOrganizationInputSchema", () => {
  it("non richiede identificatore né date: le genera il sistema", () => {
    const input = createOrganizationInputSchema.parse({ name: "Acme", slug: "acme" });
    expect(input).toEqual({ name: "Acme", slug: "acme" });
  });

  it("scarta un identificatore fornito dal chiamante", () => {
    const input = createOrganizationInputSchema.parse({
      id: ORGANIZATION_ID,
      name: "Acme",
      slug: "acme",
    });

    expect(input).not.toHaveProperty("id");
  });
});

describe("userSchema", () => {
  it("normalizza l'indirizzo e ammette nome e verifica assenti", () => {
    const user = userSchema.parse({
      id: USER_ID,
      email: "Giulia.Rossi@Example.IT",
      name: null,
      emailVerifiedAt: null,
      ...AUDIT,
    });

    expect(user.email).toBe("giulia.rossi@example.it");
    expect(user.name).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
  });

  it("non espone alcun campo di credenziali", () => {
    const user = userSchema.parse({
      id: USER_ID,
      email: "giulia.rossi@example.it",
      name: "Giulia Rossi",
      emailVerifiedAt: null,
      passwordHash: "$2b$12$non-deve-mai-arrivare-qui",
      ...AUDIT,
    });

    expect(user).not.toHaveProperty("passwordHash");
  });
});

describe("roleAtLeast", () => {
  it.each([
    ["owner", "member", true],
    ["owner", "admin", true],
    ["owner", "owner", true],
    ["admin", "member", true],
    ["admin", "owner", false],
    ["member", "admin", false],
    ["member", "member", true],
  ] as ReadonlyArray<readonly [OrganizationRole, OrganizationRole, boolean]>)(
    "%s soddisfa il requisito %s: %s",
    (role, required, expected) => {
      expect(roleAtLeast(role, required)).toBe(expected);
    },
  );
});

describe("membershipSchema", () => {
  it("lega un utente a un'organizzazione con un ruolo", () => {
    const membership = membershipSchema.parse({
      id: MEMBERSHIP_ID,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      role: "admin",
      ...AUDIT,
    });

    expect(membership.role).toBe("admin");
  });

  it("rifiuta un ruolo fuori dall'enumerazione", () => {
    expect(
      membershipSchema.safeParse({
        id: MEMBERSHIP_ID,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        role: "superadmin",
        ...AUDIT,
      }).success,
    ).toBe(false);
  });
});

describe("projectSchema", () => {
  it("richiede sempre l'organizzazione di appartenenza", () => {
    const withoutTenant = projectSchema.safeParse({
      id: PROJECT_ID,
      name: "Checkout",
      slug: "checkout",
      description: null,
      status: "active",
      ...AUDIT,
    });

    expect(withoutTenant.success).toBe(false);
  });

  it("accetta un progetto completo", () => {
    const project = projectSchema.parse({
      id: PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      name: "Checkout",
      slug: "checkout",
      description: "Rifacimento del flusso di pagamento",
      status: "active",
      ...AUDIT,
    });

    expect(project.organizationId).toBe(ORGANIZATION_ID);
    expect(project.status).toBe("active");
  });

  it("rifiuta uno stato non previsto", () => {
    expect(updateProjectInputSchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("ammette un aggiornamento parziale", () => {
    expect(updateProjectInputSchema.parse({ name: "Checkout v2" })).toEqual({
      name: "Checkout v2",
    });
  });
});

// Il punto più importante di questo file: l'organizzazione di destinazione non
// può mai arrivare dal chiamante. Se uno di questi test cade, la superficie
// pubblica accetta di nuovo un tenant scelto dal client (AGENTS.md §8.4).
describe("isolamento del tenant negli input pubblici", () => {
  it("createProjectInputSchema scarta organizationId anche se fornito", () => {
    const input = createProjectInputSchema.parse({
      organizationId: ORGANIZATION_ID,
      name: "Checkout",
      slug: "checkout",
      description: null,
    });

    expect(input).not.toHaveProperty("organizationId");
  });

  it("createMembershipInputSchema scarta organizationId anche se fornito", () => {
    const input = createMembershipInputSchema.parse({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      role: "member",
    });

    expect(input).not.toHaveProperty("organizationId");
  });
});
