import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/domain";
import { hashPassword, spendVerificationTime, verifyPassword } from "@/lib/password";

const PASSWORD = "cavallo-batteria-graffetta";

describe("hashPassword", () => {
  it("produce una stringa auto-descrittiva con algoritmo e parametri", async () => {
    const stored = await hashPassword(PASSWORD);
    const [algorithm, n, r, p, salt, key] = stored.split("$");

    expect(algorithm).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(salt).toBeTruthy();
    expect(key).toBeTruthy();
  });

  it("non contiene mai la password in chiaro", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).not.toContain(PASSWORD);
  });

  it("genera un sale diverso a ogni chiamata, quindi due hash diversi", async () => {
    const [first, second] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    expect(first).not.toBe(second);
  });
});

describe("verifyPassword", () => {
  it("riconosce la password corretta", async () => {
    const stored = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
  });

  it("rifiuta una password sbagliata", async () => {
    const stored = await hashPassword(PASSWORD);
    await expect(verifyPassword("cavallo-batteria-graffett", stored)).resolves.toBe(false);
  });

  it("verifica anche hash creati con parametri di costo diversi", async () => {
    // Simula una password registrata prima di un irrobustimento dei parametri:
    // deve continuare a funzionare, altrimenti alzare il costo scollegherebbe
    // tutti gli utenti esistenti.
    const stored = await hashPassword(PASSWORD);
    const [, , , , salt, key] = stored.split("$");
    const legacy = ["scrypt", 16384, 8, 1, salt, key].join("$");

    await expect(verifyPassword(PASSWORD, legacy)).resolves.toBe(true);
  });

  it.each([
    ["stringa vuota", ""],
    ["numero di campi errato", "scrypt$16384$8$1$abc"],
    ["algoritmo sconosciuto", "bcrypt$16384$8$1$YWJj$ZGVm"],
    ["parametri non numerici", "scrypt$N$8$1$YWJj$ZGVm"],
    ["parametro fuori intervallo", "scrypt$1$8$1$YWJj$ZGVm"],
    ["sale vuoto", "scrypt$16384$8$1$$ZGVm"],
  ])("restituisce false su hash malformato: %s", async (_name, stored) => {
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
  });

  it("non lancia su hash malformato, così una riga corrotta non diventa un 500", async () => {
    await expect(verifyPassword(PASSWORD, "spazzatura")).resolves.toBe(false);
  });
});

describe("spendVerificationTime", () => {
  it("restituisce sempre false", async () => {
    await expect(spendVerificationTime(PASSWORD)).resolves.toBe(false);
  });
});

describe("politica di lunghezza", () => {
  it("richiede una passphrase, non una password corta e contorta", () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });

  it("pone un limite superiore, perché il costo di scrypt lo paga il server", () => {
    expect(PASSWORD_MAX_LENGTH).toBeLessThanOrEqual(1024);
  });

  it("accetta una passphrase lunga fino al limite", async () => {
    const long = "a".repeat(PASSWORD_MAX_LENGTH);
    const stored = await hashPassword(long);
    await expect(verifyPassword(long, stored)).resolves.toBe(true);
  });
});
