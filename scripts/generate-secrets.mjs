#!/usr/bin/env node
/**
 * Fills the random secrets of .env.local in place, without ever printing them.
 *
 * A secret echoed to a terminal ends up in the shell history, in the scrollback
 * and — when an agent is driving — in a conversation transcript sent to a third
 * party. Generating it straight into the file is the only way to keep it out.
 *
 * Existing non-empty values are preserved: running this twice must not
 * invalidate sessions or job signatures.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = ".env.local";

/** Variable name -> how its value is encoded. */
const SECRETS = new Map([
  ["AUTH_SECRET", () => randomBytes(32).toString("base64")],
  ["JOB_SECRET", () => randomBytes(32).toString("base64url")],
  /*
   * Base64 e non base64url, e esattamente 32 byte.
   *
   * AES-256 vuole 32 byte: il modulo che la legge rifiuta qualunque altra
   * lunghezza invece di allungarla, perché una chiave stirata a forza sembra
   * lunga e porta la robustezza dell'originale (ADR-0010).
   */
  ["SECRETS_KEY", () => randomBytes(32).toString("base64")],
]);

if (!existsSync(FILE)) {
  console.error(`${FILE} non esiste. Copialo da .env.example prima di eseguire questo script.`);
  process.exit(1);
}

let content = readFileSync(FILE, "utf8");
const filled = [];
const kept = [];

for (const [name, generate] of SECRETS) {
  const line = new RegExp(`^${name}=(.*)$`, "m");
  const match = content.match(line);

  if (!match) {
    console.error(`${name} non è dichiarata in ${FILE}: controlla .env.example.`);
    process.exit(1);
  }

  if (match[1].trim() !== "") {
    kept.push(name);
    continue;
  }

  content = content.replace(line, `${name}=${generate()}`);
  filled.push(name);
}

writeFileSync(FILE, content);

// Names only: the values must never reach stdout.
if (filled.length > 0) console.log(`Generati: ${filled.join(", ")}`);
if (kept.length > 0) console.log(`Già valorizzati, lasciati intatti: ${kept.join(", ")}`);
