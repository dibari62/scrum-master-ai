import { describe, expect, it } from "vitest";

import {
  membershipIdSchema,
  organizationIdSchema,
  projectIdSchema,
  userIdSchema,
  type OrganizationId,
  type UserId,
} from "@/domain";

const VALID_UUID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";

describe("identificatori di dominio", () => {
  it.each([
    ["organizationId", organizationIdSchema],
    ["userId", userIdSchema],
    ["membershipId", membershipIdSchema],
    ["projectId", projectIdSchema],
  ])("%s accetta un UUID", (_name, schema) => {
    expect(schema.parse(VALID_UUID)).toBe(VALID_UUID);
  });

  it.each([
    ["stringa vuota", ""],
    ["numero come stringa", "42"],
    ["UUID troncato", "3f1a9c2e-8b6d-4f2a-9c1e"],
    ["testo libero", "org_acme"],
  ])("rifiuta %s", (_name, value) => {
    expect(organizationIdSchema.safeParse(value).success).toBe(false);
  });

  it("mantiene i tipi distinti a livello di compilazione", () => {
    const organizationId: OrganizationId = organizationIdSchema.parse(VALID_UUID);
    const userId: UserId = userIdSchema.parse(VALID_UUID);

    // Il valore a runtime coincide: è solo il tipo a impedire lo scambio.
    // La riga seguente non compilerebbe, ed è esattamente lo scopo del brand:
    //   const wrong: OrganizationId = userId;
    expect(String(organizationId)).toBe(String(userId));
  });
});
