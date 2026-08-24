/**
 * Schedules on Upstash QStash, from the command line.
 *
 * **Why a script and not the console.** The schedule is part of how this
 * product works: it is what turns a dashboard into something that notices. A
 * setting that exists only in somebody's browser tab is a setting nobody else
 * can find, reproduce or remove — and the day it misfires, whoever is looking
 * has no way to see what was asked for.
 *
 *   npm run qstash -- list
 *   npm run qstash -- create <url> "<cron>"
 *   npm run qstash -- delete <scheduleId>
 *
 * `JOB_SECRET` is forwarded as the `Authorization` header of the scheduled
 * call, so the route can refuse anyone else. It is read from the environment
 * and never printed: an argument would be visible in a process list.
 *
 * Behind a TLS-inspecting proxy set `NODE_OPTIONS=--use-system-ca` first.
 */

import { existsSync } from "node:fs";

const USAGE = `uso:
  node scripts/qstash.mjs list
  node scripts/qstash.mjs create <url> "<cron>"
  node scripts/qstash.mjs delete <scheduleId>

esempio:
  node scripts/qstash.mjs create https://esempio.vercel.app/api/jobs/sprint-health "0 6 * * *"`;

const BASE = "https://qstash.upstash.io/v2";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} non impostata: serve .env.local o la variabile.`);
  return value;
}

function headers() {
  return {
    Authorization: `Bearer ${requireEnv("QSTASH_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

async function list() {
  const response = await fetch(`${BASE}/schedules`, { headers: headers() });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const schedules = await response.json();

  if (schedules.length === 0) {
    console.log("nessuna schedulazione registrata");
    return;
  }

  for (const schedule of schedules) {
    console.log(`${schedule.scheduleId}  ${schedule.cron}  ${schedule.destination}`);
    if (schedule.isPaused) console.log("     in pausa");
  }
}

async function create([url, cron]) {
  if (!url || !cron) throw new Error(USAGE);

  /*
   * Il segreto viaggia come intestazione inoltrata, non nell'indirizzo.
   *
   * Un indirizzo attraversa cronologia, log dei proxy e `referer`: un segreto
   * messo lì è un segreto già speso. QStash inoltra alla destinazione ogni
   * intestazione prefissata con `Upstash-Forward-`.
   */
  const response = await fetch(`${BASE}/schedules/${encodeURIComponent(url)}`, {
    method: "POST",
    headers: {
      ...headers(),
      "Upstash-Cron": cron,
      "Upstash-Method": "POST",
      "Upstash-Forward-Authorization": `Bearer ${requireEnv("JOB_SECRET")}`,
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const created = await response.json();
  console.log(`schedulazione creata: ${created.scheduleId}`);
  console.log(`  ${cron} → ${url}`);
}

async function remove([scheduleId]) {
  if (!scheduleId) throw new Error(USAGE);

  const response = await fetch(`${BASE}/schedules/${scheduleId}`, {
    method: "DELETE",
    headers: headers(),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  console.log(`schedulazione rimossa: ${scheduleId}`);
}

const COMMANDS = { list, create, delete: remove };

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const [command, ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];

  if (!handler) {
    console.error(USAGE);
    process.exit(2);
  }

  await handler(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
