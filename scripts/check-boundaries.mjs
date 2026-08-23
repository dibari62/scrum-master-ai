#!/usr/bin/env node
/**
 * Enforces the architectural boundaries declared in AGENTS.md and ADR-0003.
 *
 * Runs with zero dependencies so it works before (and independently of) any
 * package installation. Exits non-zero on the first violation set found.
 *
 *   app -> agents -> metrics -> domain
 *   app -> db -> domain
 *   connectors -> domain
 *
 * `domain` imports nothing from other layers. `metrics` performs no I/O.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const CODE_EXT = /\.(ts|tsx|mts|cts)$/;

/** Layer-scoped rules. `test` receives the import specifier of each statement. */
const RULES = [
  {
    layer: "domain",
    reason:
      "src/domain is the canonical model: it must not depend on any other layer (ADR-0003).",
    forbid: (spec) =>
      /(^|\/)\.\.\/(metrics|db|agents|connectors|app|lib)(\/|$)/.test(spec) ||
      /^@\/(metrics|db|agents|connectors|app|lib)(\/|$)/.test(spec) ||
      /^(next|react|drizzle-orm|@?ai|ai)(\/|$)/.test(spec),
  },
  {
    layer: "metrics",
    reason:
      "src/metrics must stay pure: no I/O, no database, no network, no LLM (ADR-0002).",
    forbid: (spec) =>
      /^node:(fs|http|https|net|dns|child_process)/.test(spec) ||
      /^(fs|http|https|net|child_process)$/.test(spec) ||
      /^(drizzle-orm|postgres|pg|@neondatabase)/.test(spec) ||
      /(^|\/)\.\.\/(db|connectors|app|agents)(\/|$)/.test(spec) ||
      /^@\/(db|connectors|app|agents)(\/|$)/.test(spec) ||
      /^(ai|@ai-sdk|langchain|@langchain)/.test(spec),
  },
  {
    layer: "components",
    reason:
      "src/components is presentation only: it receives ready-made data from app and must not reach into db, agents, metrics or connectors (AGENTS.md §4).",
    forbid: (spec) =>
      /(^|\/)\.\.\/(db|agents|metrics|connectors|app)(\/|$)/.test(spec) ||
      /^@\/(db|agents|metrics|connectors|app)(\/|$)/.test(spec),
  },
  {
    layer: "connectors",
    reason:
      "Connectors translate towards the canonical model; they must not reach into app, metrics or agents (ADR-0003).",
    forbid: (spec) =>
      /(^|\/)\.\.\/(app|metrics|agents)(\/|$)/.test(spec) ||
      /^@\/(app|metrics|agents)(\/|$)/.test(spec),
  },
  {
    /*
     * Skills consume metrics; they are consumed by the application.
     *
     * The arrow in AGENTS.md §4 runs `app → agents → metrics → domain`, and
     * until now nothing enforced its right-hand side because `src/agents` did
     * not exist. A skill that reached back into `app` would be a page and a
     * capability at once, and could no longer be tested without a framework.
     */
    layer: "agents",
    reason:
      "src/agents is consumed by app, never the reverse, and does not translate external formats (AGENTS.md §4).",
    forbid: (spec) =>
      /(^|\/)\.\.\/(app|connectors|components)(\/|$)/.test(spec) ||
      /^@\/(app|connectors|components)(\/|$)/.test(spec),
  },
];

/** Imports allowed only inside specific directories. */
const CONFINED = [
  {
    /*
     * The model SDK, and nothing else, reaches the gateway.
     *
     * `src/agents` used to be allowed here too, which contradicted both
     * ADR-0004 — "l'accesso al modello passa esclusivamente dal gateway in
     * src/lib/llm" — and criterio 19 of the T3 spec, which requires this very
     * check to catch a violation. A skill that could call the SDK directly
     * would bypass budget, fallback and cost measurement in one line.
     */
    match: (spec) => /^(ai|@ai-sdk\/)/.test(spec),
    allowedIn: ["src/lib/llm"],
    reason:
      "All model calls must go through the gateway in src/lib/llm (ADR-0004, criterio 19).",
  },
  {
    /*
     * Graph orchestration belongs to skills, not to the gateway.
     *
     * ADR-0004 admits a graph only where a capability needs durable state or
     * human approval in the middle — that is a property of a skill, so the
     * dependency lives with them and never leaks into the transport layer.
     */
    match: (spec) => /^(langchain|@langchain\/)/.test(spec),
    allowedIn: ["src/agents"],
    reason: "Graph orchestration is confined to src/agents (ADR-0004).",
  },
  {
    match: (spec) => /^(drizzle-orm|postgres|pg|@neondatabase)/.test(spec),
    allowedIn: ["src/db"],
    reason: "Database access is confined to src/db (AGENTS.md §4).",
  },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (CODE_EXT.test(entry)) out.push(full);
  }
  return out;
}

/** Extracts import/export/require specifiers without parsing the whole file. */
function importsOf(source) {
  const specs = [];
  const patterns = [
    /\bimport\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

const violations = [];

for (const rule of RULES) {
  for (const file of walk(join(SRC, rule.layer))) {
    const rel = relative(ROOT, file).split(sep).join("/");
    for (const spec of importsOf(readFileSync(file, "utf8"))) {
      if (rule.forbid(spec)) {
        violations.push({ file: rel, spec, reason: rule.reason });
      }
    }
  }
}

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  for (const spec of importsOf(readFileSync(file, "utf8"))) {
    for (const rule of CONFINED) {
      if (!rule.match(spec)) continue;
      if (rule.allowedIn.some((dir) => rel.startsWith(`${dir}/`))) continue;
      violations.push({ file: rel, spec, reason: rule.reason });
    }
  }
}

if (violations.length === 0) {
  console.log("Architectural boundaries: OK");
  process.exit(0);
}

console.error(`\nArchitectural boundary violations: ${violations.length}\n`);
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    imports "${v.spec}"`);
  console.error(`    ${v.reason}\n`);
}
console.error("See AGENTS.md §4 and docs/architecture/ for the rationale.\n");
process.exit(1);
