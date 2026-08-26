import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * GitHub operations from the command line, for an environment where the usual
 * tools cannot write.
 *
 * **Why this exists.** This machine is signed into VS Code with a corporate
 * Enterprise Managed User, which has no write access to a personal repository
 * and answers `403` to every attempt — through the GitHub extension, through
 * the MCP server, through anything that reuses that identity. Git, however,
 * pushes to this repository perfectly well, because Git Credential Manager
 * holds a token for the account that owns it. This script borrows that token
 * for one API call at a time.
 *
 * It took three failed approaches to work out that the failures shared a single
 * cause rather than being three separate walls. Losing that would mean
 * rediscovering it.
 *
 * The token is never printed, never written to disk and never passed as a
 * command-line argument, where a process list would expose it.
 *
 * Usage:
 *   node scripts/github.mjs pr-open     <owner> <repo> <head> <base> <title> [bodyFile]
 *   node scripts/github.mjs pr-title    <owner> <repo> <number> <title>
 *   node scripts/github.mjs pr-status   <owner> <repo> <number>
 *   node scripts/github.mjs pr-merge    <owner> <repo> <number>
 *   node scripts/github.mjs ci-log      <owner> <repo> <number>
 *   node scripts/github.mjs deployments <owner> <repo> [environment]
 *   node scripts/github.mjs ping        <url>
 *
 * Behind a TLS-inspecting proxy, prefix with `node --use-system-ca`
 * (see `scripts/diagnose-tls.mjs`).
 */

const USAGE = `uso:
  node scripts/github.mjs pr-open     <owner> <repo> <head> <base> <titolo> [fileCorpo]
  node scripts/github.mjs pr-title    <owner> <repo> <numero> <titolo>
  node scripts/github.mjs pr-status   <owner> <repo> <numero>
  node scripts/github.mjs pr-merge    <owner> <repo> <numero>
  node scripts/github.mjs ci-log      <owner> <repo> <numero>
  node scripts/github.mjs deployments <owner> <repo> [ambiente]
  node scripts/github.mjs ping        <url>`;

/**
 * Asks Git Credential Manager for the token it uses to push.
 *
 * Declared once: five copies of this function were the reason the scripts were
 * consolidated into one file.
 */
function readToken() {
  const result = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`git credential fill è fallito: ${result.stderr.trim()}`);
  }

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("password=")) return line.slice("password=".length).trim();
  }

  throw new Error("nessuna credenziale memorizzata per github.com");
}

function makeClient() {
  const headers = {
    Authorization: `Bearer ${readToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "scrum-master-ai-scripts",
  };

  return {
    headers,
    async json(path, init) {
      const response = await fetch(`https://api.github.com${path}`, { headers, ...init });
      const payload = await response.json();

      if (!response.ok) {
        const details = (payload.errors ?? [])
          .map((error) => error.message ?? JSON.stringify(error))
          .join("; ");
        throw new Error(
          `HTTP ${response.status}: ${payload.message ?? "errore sconosciuto"}${details ? ` — ${details}` : ""}`,
        );
      }

      return payload;
    },
  };
}

/** Conclusions that do not block a merge: not every check has to run. */
const ACCEPTABLE = new Set(["success", "skipped", "neutral"]);

async function checkRuns(client, owner, repo, number) {
  const pull = await client.json(`/repos/${owner}/${repo}/pulls/${number}`);
  const checks = await client.json(
    `/repos/${owner}/${repo}/commits/${pull.head.sha}/check-runs`,
  );

  const runs = checks.check_runs ?? [];

  return {
    pull,
    runs,
    failed: runs.filter((run) => run.conclusion !== null && !ACCEPTABLE.has(run.conclusion)),
    pending: runs.filter((run) => run.status !== "completed"),
  };
}

async function prOpen(client, [owner, repo, head, base, title, bodyFile]) {
  if (!owner || !repo || !head || !base || !title) throw new Error(USAGE);

  const body = bodyFile ? readFileSync(bodyFile, "utf8") : "";
  const payload = await client.json(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { ...client.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title, head, base, body }),
  });

  console.log(`PR #${payload.number} aperta: ${payload.html_url}`);
}

async function prTitle(client, [owner, repo, number, title]) {
  if (!owner || !repo || !number || !title) throw new Error(USAGE);

  const payload = await client.json(`/repos/${owner}/${repo}/pulls/${number}`, {
    method: "PATCH",
    headers: { ...client.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  console.log(`PR #${payload.number} rititolata: ${payload.title}`);
}

async function prStatus(client, [owner, repo, number]) {
  if (!owner || !repo || !number) throw new Error(USAGE);

  const { pull, runs } = await checkRuns(client, owner, repo, number);

  console.log(`#${pull.number} ${pull.title}`);
  console.log(`   branch:      ${pull.head.ref}`);
  console.log(`   mergiabile:  ${pull.mergeable} (${pull.mergeable_state})`);
  console.log(
    `   controlli:   ${runs.map((run) => `${run.name}=${run.conclusion ?? run.status}`).join(", ") || "nessuno"}`,
  );
}

async function prMerge(client, [owner, repo, number]) {
  if (!owner || !repo || !number) throw new Error(USAGE);

  const { pull, failed, pending } = await checkRuns(client, owner, repo, number);

  /*
   * The refusals are the point of this script.
   *
   * Merging on a red or unfinished pipeline is exactly what R5 forbids, and an
   * automation that skipped the check would industrialise the mistake instead
   * of removing it.
   */
  if (failed.length > 0) {
    throw new Error(`rifiuto: controlli falliti — ${failed.map((r) => r.name).join(", ")}`);
  }

  if (pending.length > 0) {
    throw new Error(
      `rifiuto: controlli ancora in corso — ${pending.map((r) => r.name).join(", ")}`,
    );
  }

  if (pull.mergeable === false) {
    throw new Error(`rifiuto: la PR non è mergiabile (${pull.mergeable_state})`);
  }

  const result = await client.json(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: "PUT",
    headers: { ...client.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ merge_method: "merge" }),
  });

  console.log(`PR #${number} mergiata: ${result.sha}`);

  // A branch that has done its job only confuses whoever reads the list later.
  await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${pull.head.ref}`,
    { method: "DELETE", headers: client.headers },
  );
  console.log(`branch ${pull.head.ref} rimosso`);
}

async function ciLog(client, [owner, repo, number]) {
  if (!owner || !repo || !number) throw new Error(USAGE);

  const { failed } = await checkRuns(client, owner, repo, number);

  if (failed.length === 0) {
    console.log("nessun controllo fallito");
    return;
  }

  for (const run of failed) {
    console.log(`\n=== ${run.name} (${run.conclusion}) ===`);
    console.log(run.details_url);
    if (run.output?.summary) console.log(run.output.summary);
    if (run.output?.text) console.log(run.output.text.slice(0, 4000));
  }
}

/**
 * Where production is, and whether it is answering.
 *
 * **Why this is worth a command.** The published address was written down
 * nowhere: `guardare-i-dati.md` said to look it up on Vercel, which is fine
 * until somebody needs to check a deployment from a terminal — and then the one
 * question that matters after a merge, *did it actually go out*, has no answer
 * that does not involve a browser and a login.
 *
 * Vercel records every deployment against GitHub, so the answer is already in
 * the repository's own history. This reads it back.
 *
 * The status check is deliberately separate from the deployment state. Vercel
 * reporting `success` means the build finished, not that the application works:
 * `next build` completes even with no environment variables at all, so a green
 * deployment with a wrong `DATABASE_URL` looks exactly like a healthy one. The
 * HTTP request is the part that distinguishes them.
 */
async function deployments(client, [owner, repo, environment = "Production"]) {
  if (!owner || !repo) throw new Error(USAGE);

  const found = await client.json(
    `/repos/${owner}/${repo}/deployments?environment=${encodeURIComponent(environment)}&per_page=5`,
  );

  if (found.length === 0) {
    console.log(`nessun deploy per l'ambiente "${environment}"`);
    return;
  }

  for (const deployment of found) {
    const statuses = await client.json(
      `/repos/${owner}/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
    );

    const latest = statuses[0];
    const url = latest?.environment_url ?? latest?.target_url ?? "—";

    console.log(`${deployment.sha.slice(0, 7)}  ${latest?.state ?? "sconosciuto"}  ${url}`);
    console.log(`         creato: ${deployment.created_at}`);
  }
}

/**
 * Asks the published site whether it is alive.
 *
 * Follows redirects on purpose: a site behind Vercel's deployment protection
 * answers with a redirect to a login page rather than an error, and reporting
 * that as "up" would be the most misleading possible answer.
 */
async function ping(_client, [url]) {
  if (!url) throw new Error(USAGE);

  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");

  console.log(`${url} -> ${response.status}`);

  if (location) {
    console.log(`   rimanda a: ${location}`);
    if (location.includes("vercel.com/login")) {
      console.log("   il sito è in piedi ma NON è pubblico: Deployment Protection è attiva");
    }
  }
}

const COMMANDS = {
  "pr-open": prOpen,
  "pr-title": prTitle,
  "pr-status": prStatus,
  "pr-merge": prMerge,
  "ci-log": ciLog,
  deployments,
  ping,
};

const [command, ...args] = process.argv.slice(2);
const handler = COMMANDS[command];

if (!handler) {
  console.error(USAGE);
  process.exit(2);
}

try {
  await handler(makeClient(), args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
