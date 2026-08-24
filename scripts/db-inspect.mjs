/**
 * Read-only inspection of the database.
 *
 * For the verification steps no test can cover: what is actually stored, as
 * opposed to what the code believes it stored. A silent mismatch between the
 * two is how every estimate in `work_items` stayed null while the dashboard
 * dutifully reported "nessuna stima" for four sprints.
 *
 * Read-only by construction: this file contains no `insert`, `update` or
 * `delete`. Writing to a shared database from a convenience script is how
 * demonstration data gets destroyed.
 *
 *   npm run db:inspect              -- riepilogo
 *   npm run db:inspect -- tenants   -- organizzazioni, utenti, progetti
 *   npm run db:inspect -- sprints   -- sprint con stime e conteggi
 *   npm run db:inspect -- agents    -- capacità accese, tetto e uso di oggi
 *   npm run db:inspect -- tables    -- tabelle e righe
 *
 * Behind a TLS-inspecting proxy set `NODE_OPTIONS=--use-system-ca` first
 * (see `scripts/diagnose-tls.mjs`).
 */

import { existsSync } from "node:fs";

import { neon } from "@neondatabase/serverless";

const QUERIES = {
  tables: {
    title: "TABELLE",
    sql: `select table_name,
            (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I', table_name),
                           false, true, '')))[1]::text::int as righe
          from information_schema.tables
          where table_schema = 'public'
          order by table_name`,
  },
  tenants: {
    title: "ORGANIZZAZIONI, UTENTI E PROGETTI",
    sql: `select o.name as organizzazione,
                 o.slug,
                 count(distinct m.user_id)::int as membri,
                 count(distinct p.id)::int      as progetti,
                 count(*) filter (
                   where u.email = 'ispettore-temporaneo@example.invalid'
                 )::int as ispettore_membro
          from organizations o
          left join memberships m on m.organization_id = o.id
          left join users u       on u.id = m.user_id
          left join projects p    on p.organization_id = o.id
          group by o.id, o.name, o.slug
          order by o.name`,
  },
  sprints: {
    title: "SPRINT",
    sql: `select s.name as sprint,
                 s.starts_at::date as inizio,
                 s.ends_at::date   as fine,
                 count(w.id)::int  as elementi,
                 coalesce(sum(w.estimate_value), 0)::int as punti_assegnati,
                 count(*) filter (where w.estimate_value is null)::int as senza_stima
          from sprints s
          left join work_items w on w.sprint_id = s.id
          group by s.id, s.name, s.starts_at, s.ends_at
          order by s.starts_at`,
  },
  agents: {
    title: "SCRUM MASTER AI: CAPACITÀ ACCESE ED ESECUZIONI DI OGGI",
    sql: `select p.slug as progetto,
                 a.name as agente,
                 a.status as stato,
                 a.enabled_skill_keys::text as capacita_accese,
                 to_char(a.updated_at at time zone 'utc', 'HH24:MI:SS') as ultima_modifica_utc,
                 a.max_runs_per_day::int as tetto_giornaliero,
                 count(r.id) filter (
                   where r.started_at >= date_trunc('day', now() at time zone 'utc')
                 )::int as esecuzioni_oggi
          from scrum_agents a
          join projects p on p.id = a.project_id
          left join skill_runs r on r.scrum_agent_id = a.id
          group by p.slug, a.name, a.status, a.enabled_skill_keys, a.max_runs_per_day,
                   a.updated_at
          order by p.slug`,
  },
  summary: {
    title: "RIEPILOGO",
    sql: `select
            (select count(*) from organizations)      as organizzazioni,
            (select count(*) from projects)           as progetti,
            (select count(*) from sprints)            as sprint,
            (select count(*) from work_items)         as elementi,
            (select count(*) from state_transitions)  as transizioni,
            (select count(*) from sprint_scope_events) as variazioni_perimetro`,
  },
};

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL non impostata: vedi docs/setup-ambiente.md");
    process.exit(1);
  }

  const what = process.argv[2] ?? "summary";
  const query = QUERIES[what];

  if (!query) {
    console.error(`sconosciuto: ${what}. Disponibili: ${Object.keys(QUERIES).join(", ")}`);
    process.exit(2);
  }

  // The host, never the credentials: knowing *which* database answered is the
  // whole point when development and production share one.
  console.log(`database: ${new URL(url).host}`);
  console.log("");
  console.log(query.title);

  const sql = neon(url);
  const rows = await sql.query(query.sql);

  if (rows.length === 0) {
    console.log("  (nessuna riga)");
    return;
  }

  for (const row of rows) {
    console.log(
      "  " +
        Object.entries(row)
          .map(([key, value]) => `${key}=${value ?? "—"}`)
          .join("  "),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
