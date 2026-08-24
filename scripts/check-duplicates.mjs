/**
 * Looks for duplicated data, in the database and in what the pages would show.
 *
 * **Two different questions, easily confused.** Whether rows are duplicated in
 * the database is a defect of ingestion; whether a page shows the same row
 * twice is a defect of presentation. Only the first is visible from here, and
 * only the first can be fixed once — the second reappears with every new screen.
 *
 * Every check states what the *right* answer is, because "3 gruppi" means
 * nothing on its own: three reports on one sprint are expected and correct,
 * three work items with one source identifier are a broken ingestion.
 *
 * Read-only by construction: no insert, no update, no delete. Writing to a
 * shared database from a convenience script is how demonstration data gets
 * destroyed.
 *
 *   npm run db:duplicates
 *
 * Behind a TLS-inspecting proxy set `NODE_OPTIONS=--use-system-ca` first
 * (see `scripts/diagnose-tls.mjs`).
 */

import { existsSync } from "node:fs";

import { neon } from "@neondatabase/serverless";

/**
 * `severity` says what a hit means:
 *   - `defect`   nothing should ever match; a hit is a bug
 *   - `expected` matches are normal, and the count is shown for information
 */
const CHECKS = [
  {
    name: "elementi con lo stesso identificativo di origine",
    severity: "defect",
    why: "l'ingestione deve riconoscere un elemento già visto, non crearne un secondo",
    sql: `select project_id::text, source_system::text, source_id, count(*)::int as n
          from work_items group by 1,2,3 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "sprint con lo stesso identificativo di origine",
    severity: "defect",
    why: "due sprint identici falserebbero ogni metrica per sprint",
    sql: `select project_id::text, source_system::text, source_id, count(*)::int as n
          from sprints group by 1,2,3 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "persone con lo stesso identificativo di origine",
    severity: "defect",
    why: "la stessa persona contata due volte gonfia la dimensione del team",
    sql: `select project_id::text, source_system::text, source_id, count(*)::int as n
          from people group by 1,2,3 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "transizioni di stato identiche ripetute",
    severity: "defect",
    why: "una transizione contata due volte sposta cycle time ed efficienza di flusso",
    sql: `select work_item_id::text, from_state::text, to_state::text,
                 occurred_at::text, count(*)::int as n
          from state_transitions group by 1,2,3,4 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "eventi di composizione dello sprint ripetuti",
    severity: "defect",
    why: "un ingresso contato due volte falsa il cambio di perimetro",
    sql: `select sprint_id::text, work_item_id::text, kind::text,
                 occurred_at::text, count(*)::int as n
          from sprint_scope_events group by 1,2,3,4 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "progetti con lo stesso identificativo nella stessa azienda",
    severity: "defect",
    why: "l'indirizzo di un progetto non potrebbe più puntare a uno solo",
    sql: `select organization_id::text, slug, count(*)::int as n
          from projects group by 1,2 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "più di uno Scrum Master AI per progetto",
    severity: "defect",
    why: "la scheda ne mostra uno: gli altri sarebbero invisibili e attivi",
    sql: `select project_id::text, count(*)::int as n
          from scrum_agents group by 1 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "utenti con lo stesso indirizzo email",
    severity: "defect",
    why: "l'accesso non saprebbe quale dei due sta entrando",
    sql: `select lower(email) as email, count(*)::int as n
          from users group by 1 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "un elemento in più sprint contemporaneamente",
    severity: "defect",
    why: "`sprint_id` è uno solo: due appartenenze aperte insieme sono incoerenti",
    sql: `select w.id::text, count(distinct e.sprint_id)::int as n
          from work_items w
          join sprint_scope_events e on e.work_item_id = w.id and e.kind = 'added'
          where not exists (
            select 1 from sprint_scope_events r
            where r.work_item_id = w.id and r.sprint_id = e.sprint_id
              and r.kind = 'removed' and r.occurred_at > e.occurred_at
          )
          group by 1 having count(distinct e.sprint_id) > 1 order by n desc limit 5`,
  },
  {
    name: "impedimenti con lo stesso identificativo di origine",
    severity: "defect",
    why: "lo stesso ostacolo contato due volte allunga il registro senza allungare la storia",
    sql: `select project_id::text, source_system::text, source_id, count(*)::int as n
          from impediments group by 1,2,3 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "colonne della bacheca con lo stesso identificativo di origine",
    severity: "defect",
    why: "una colonna duplicata mostrerebbe due volte lo stesso conteggio di elementi",
    sql: `select project_id::text, source_system::text, source_id, count(*)::int as n
          from board_columns group by 1,2,3 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "colonne diverse nella stessa posizione della bacheca",
    severity: "defect",
    why: "la posizione è l'ordine del flusso: due colonne alla stessa non hanno un ordine",
    sql: `select board_id::text, position, count(*)::int as n
          from board_columns group by 1,2 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "più colonne per lo stesso stato canonico",
    severity: "expected",
    why: "«in revisione» e «in attesa di collaudo» sono legittimamente lo stesso stato; il conteggio per colonna, in quel caso, viene dichiarato non attribuibile",
    sql: `select board_id::text, state::text, count(*)::int as n
          from board_columns group by 1,2 having count(*) > 1 order by n desc limit 5`,
  },
  {
    name: "resoconti multipli sullo stesso sprint",
    severity: "expected",
    why: "rigenerare aggiunge invece di sostituire; la scheda mostra solo il più recente",
    sql: `select sprint_id::text, count(*)::int as n
          from sprint_reports group by 1 having count(*) > 1 order by n desc limit 5`,
  },
];

const TABLES = [
  "organizations",
  "users",
  "memberships",
  "projects",
  "sprints",
  "work_items",
  "state_transitions",
  "sprint_scope_events",
  "people",
  "boards",
  "board_columns",
  "comments",
  "impediments",
  "pull_requests",
  "scrum_agents",
  "project_contexts",
  "skill_runs",
  "sprint_reports",
];

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL non impostata: serve .env.local o la variabile d'ambiente.");
    process.exit(2);
  }

  const sql = neon(url);

  console.log(`database: ${new URL(url).host}\n`);
  console.log("DUPLICATI E COERENZA");

  let defects = 0;

  for (const check of CHECKS) {
    const rows = await sql.query(check.sql);

    if (rows.length === 0) {
      console.log(`  ok    ${check.name}`);
      continue;
    }

    if (check.severity === "expected") {
      const total = rows.reduce((sum, row) => sum + row.n, 0);
      console.log(`  --    ${check.name}: ${rows.length} gruppi, ${total} righe (atteso)`);
      console.log(`        ${check.why}`);
      continue;
    }

    defects += 1;
    console.log(`  NO    ${check.name}: ${rows.length} gruppi`);
    console.log(`        ${check.why}`);
    for (const row of rows.slice(0, 3)) {
      console.log(
        `        ${Object.entries(row)
          .map(([key, value]) => `${key}=${value}`)
          .join("  ")}`,
      );
    }
  }

  console.log("\nRIGHE PER TABELLA");
  for (const table of TABLES) {
    const [row] = await sql.query(`select count(*)::int as n from ${table}`);
    console.log(`  ${String(row.n).padStart(7)}  ${table}`);
  }

  console.log(
    defects === 0
      ? "\nNessun duplicato che non sia atteso."
      : `\n${defects} controlli con duplicati non attesi.`,
  );

  if (defects > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
