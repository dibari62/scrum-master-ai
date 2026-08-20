#!/usr/bin/env node
/**
 * Placeholder for the npm scripts declared in AGENTS.md §6 whose toolchain does
 * not exist yet (Playwright, eval runner, Drizzle, seed connector).
 *
 * They must exist so the documented contract stays honest, and they must FAIL
 * loudly: a script that exits 0 without doing anything would let an agent — or
 * the CI — believe a step ran when it never did.
 */

/** Script name -> roadmap milestone that will implement it. */
const OWNERS = new Map([
  ["test:e2e", { milestone: "T0/T1", detail: "Playwright non è ancora configurato." }],
  ["eval", { milestone: "T4", detail: "Il runner delle eval in evals/ non esiste ancora." }],
  [
    "db:generate",
    { milestone: "T1", detail: "Lo schema Drizzle in src/db non esiste ancora." },
  ],
  [
    "db:migrate",
    { milestone: "T1", detail: "Non esiste ancora alcuna migrazione da applicare." },
  ],
  ["seed", { milestone: "T1", detail: "Il connettore seed non esiste ancora." }],
]);

const name = process.argv[2] ?? "(sconosciuto)";
const owner = OWNERS.get(name);

console.error(`\n  npm run ${name}: NON ANCORA IMPLEMENTATO`);
if (owner) {
  console.error(`  ${owner.detail}`);
  console.error(`  Previsto dal traguardo ${owner.milestone} (docs/roadmap.md).`);
}
console.error(
  "  Questo script esce con codice 1 di proposito: non deve mai simulare un successo.\n",
);

process.exit(1);
