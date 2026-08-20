#!/usr/bin/env node
/**
 * Checks that .env.local is complete and that the database actually answers.
 *
 * Values are never printed: only variable names, lengths and shape verdicts.
 * The point is to fail here rather than three milestones later, when a wrong
 * connection string surfaces as an unrelated error.
 *
 * Connectivity goes through Neon's HTTP SQL endpoint, so no driver dependency
 * is needed at a stage where src/db does not exist yet.
 */

import { readFileSync, existsSync } from "node:fs";

const FILE = ".env.local";

/** name -> [required, description] */
const EXPECTED = new Map([
  ["DATABASE_URL", [true, "connessione Neon per l'applicazione (pooled)"]],
  ["DATABASE_URL_UNPOOLED", [true, "connessione Neon diretta, per le migrazioni"]],
  ["AUTH_SECRET", [true, "segreto di sessione Auth.js"]],
  ["AUTH_URL", [true, "URL di base dell'applicazione"]],
  ["AUTH_GITHUB_ID", [false, "OAuth App GitHub di sviluppo"]],
  ["AUTH_GITHUB_SECRET", [false, "OAuth App GitHub di sviluppo"]],
  ["LLM_PROVIDER", [true, "provider attivo: gemini | groq | fake"]],
  ["GEMINI_API_KEY", [false, "chiave Google AI Studio"]],
  ["GROQ_API_KEY", [false, "chiave Groq"]],
  ["JOB_SECRET", [true, "segreto delle route dei job"]],
  ["QSTASH_TOKEN", [false, "QStash, serve da T5"]],
  ["QSTASH_CURRENT_SIGNING_KEY", [false, "QStash, serve da T5"]],
  ["QSTASH_NEXT_SIGNING_KEY", [false, "QStash, serve da T5"]],
]);

if (!existsSync(FILE)) {
  console.error(`${FILE} non esiste. Copialo da .env.example.`);
  process.exit(1);
}

/** Minimal .env parser: enough for a key=value file, no interpolation. */
function parseEnv(text) {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

const env = parseEnv(readFileSync(FILE, "utf8"));
const problems = [];
const warnings = [];

console.log("Presenza delle variabili\n");

for (const [name, [required, description]] of EXPECTED) {
  const value = env.get(name) ?? "";
  if (value === "") {
    const mark = required ? "MANCANTE" : "vuota";
    console.log(`  [${mark.padEnd(8)}] ${name}  — ${description}`);
    if (required) problems.push(`${name} è obbligatoria ed è vuota`);
    else warnings.push(`${name} non valorizzata (${description})`);
    continue;
  }
  console.log(`  [ok      ] ${name}  (${value.length} caratteri)`);
}

const unknown = [...env.keys()].filter((k) => !EXPECTED.has(k));
if (unknown.length > 0) {
  warnings.push(`variabili non previste da .env.example: ${unknown.join(", ")}`);
}

console.log("\nCoerenza dei valori\n");

function check(label, condition, failure) {
  console.log(`  [${condition ? "ok  " : "NO  "}] ${label}`);
  if (!condition) problems.push(failure);
}

const pooled = env.get("DATABASE_URL") ?? "";
const direct = env.get("DATABASE_URL_UNPOOLED") ?? "";

if (pooled !== "" && direct !== "") {
  check(
    "entrambe iniziano con postgresql://",
    /^postgres(ql)?:\/\//.test(pooled) && /^postgres(ql)?:\/\//.test(direct),
    'manca il prefisso "postgresql://" su almeno una stringa: copiala interamente, il campo Host della console Neon non lo include',
  );
  check(
    "DATABASE_URL usa l'host con -pooler",
    /-pooler\./.test(pooled),
    "DATABASE_URL non punta al pooler: in serverless esaurirà le connessioni",
  );
  check(
    "DATABASE_URL_UNPOOLED usa l'host diretto",
    !/-pooler\./.test(direct),
    "DATABASE_URL_UNPOOLED punta al pooler: le migrazioni falliranno",
  );
  check(
    "le due stringhe differiscono solo per il pooler",
    pooled.replace("-pooler.", ".") === direct,
    "le due stringhe divergono oltre il suffisso -pooler: password o database diversi?",
  );
  check(
    "sslmode richiesto su entrambe",
    /sslmode=require/.test(pooled) && /sslmode=require/.test(direct),
    "manca sslmode=require su almeno una stringa di connessione",
  );
}

const provider = env.get("LLM_PROVIDER") ?? "";
check(
  'LLM_PROVIDER è "fake" in sviluppo',
  provider === "fake",
  `LLM_PROVIDER="${provider}": in sviluppo deve essere "fake" (AGENTS.md §9)`,
);

const authUrl = env.get("AUTH_URL") ?? "";
check(
  "AUTH_URL punta a localhost",
  authUrl.includes("localhost"),
  `AUTH_URL="${authUrl}" non è locale: in .env.local ci si aspetta localhost`,
);

/**
 * Shows the shape of a connection string with the password blanked out.
 * Deliberately scheme-agnostic: a malformed string is exactly when this runs,
 * and a redaction that only works on well-formed input is not a redaction.
 */
function redact(connectionString) {
  const masked = connectionString.replace(/(\/\/[^:@/]+:)[^@]*@/, "$1***@");
  const safe = masked.includes("***") ? masked : "(struttura non riconosciuta)";
  return safe.length > 160 ? `${safe.slice(0, 160)}…` : safe;
}

/** Runs a query through Neon's HTTP SQL endpoint. */
async function query(connectionString, sql) {
  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error(
      `la stringa non è un URL valido. Struttura letta: ${redact(connectionString)}`,
    );
  }
  const response = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": connectionString,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "true",
    },
    body: JSON.stringify({ query: sql, params: [] }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

console.log("\nConnessione al database\n");

if (pooled === "") {
  console.log("  saltata: DATABASE_URL non valorizzata");
} else {
  try {
    const started = Date.now();
    const result = await query(
      pooled,
      "select current_database(), version(), (select count(*) from pg_extension where extname = 'vector')",
    );
    const [database, version, vector] = result.rows[0];
    const elapsed = Date.now() - started;

    console.log(`  [ok  ] connessione riuscita in ${elapsed} ms`);
    console.log(`         database: ${database}`);
    console.log(`         ${String(version).split(" on ")[0]}`);

    if (vector === "1" || vector === 1) {
      console.log("  [ok  ] estensione pgvector abilitata");
    } else {
      console.log("  [NO  ] estensione pgvector NON abilitata");
      warnings.push(
        "pgvector non risulta abilitato: esegui CREATE EXTENSION IF NOT EXISTS vector; (serve da T6)",
      );
    }
  } catch (error) {
    console.log(`  [NO  ] connessione fallita: ${error.message}`);
    problems.push("il database non risponde con DATABASE_URL");
  }
}

console.log("");

for (const warning of warnings) console.log(`Avviso: ${warning}`);

if (problems.length > 0) {
  console.error(`\nProblemi bloccanti: ${problems.length}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("\nAmbiente locale verificato.");
