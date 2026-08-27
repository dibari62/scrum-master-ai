/**
 * Quanto del libro è implementato — contato, non stimato.
 *
 * **Perché è un comando e non un numero scritto in un documento.** Una
 * percentuale a mano invecchia al primo lavoro finito, e nessuno si ricorda di
 * aggiornarla: diventa una cifra che sembra un fatto e non lo è più. Questo
 * legge `docs/scrum-dalle-trincee.md`, che è la mappa che si aggiorna
 * comunque, e ricalcola ogni volta.
 *
 * Se il numero sembra sbagliato, la risposta è nella mappa e non qui: ogni
 * riga porta la citazione del libro e lo stato, ed è lì che si discute.
 *
 * Uso:
 *   npm run libro
 */

import { readFileSync } from "node:fs";

const MAP = "docs/scrum-dalle-trincee.md";

const DONE = "\u2705";
const PARTIAL = "\uD83D\uDFE1";
const TODO = "\u2B1C";
const BLOCKED = "\u26D4";

/**
 * Tre cose che il conteggio ingenuo sbaglia, tutte scoperte contando.
 *
 * 1. **R4 compare due volte**, nella sezione sulla previsione e in quella sul
 *    piano di rilascio, perché appartiene a entrambe. È una regola sola.
 * 2. **Tre righe non sono lavoro di sviluppo.** Y3 («nel dubbio prendi meno
 *    storie») ed E4 («si stima il lavoro totale») sono regole per le persone;
 *    E3 è una conversione che il libro stesso dichiara superata. Sono marcate
 *    «—» nella mappa, e contarle come «da fare» direbbe che manca del software
 *    che non deve esistere.
 * 3. **S1-S7 non sono regole del libro.** Sono la *nostra* ricostruzione di una
 *    figura che il PDF non lascia leggere, dichiarata come tale nella mappa.
 */
function statusOf(row) {
  if (row.includes(DONE)) return "fatto";
  if (row.includes(PARTIAL)) return "parziale";
  if (row.includes(BLOCKED)) return "bloccato";
  if (row.includes(TODO)) return "da fare";
  return "non è sviluppo";
}

const lines = readFileSync(MAP, "utf8").split(/\r?\n/);

const seen = new Set();
const rows = [];

for (const row of lines) {
  if (!/^\| [A-Z]?\d+ \|/.test(row) || /^\| S\d/.test(row)) continue;

  const id = /^\| ([A-Z]?\d+) \|/.exec(row)[1];
  if (seen.has(id)) continue;
  seen.add(id);

  rows.push({ id, status: statusOf(row) });
}

/** Le sezioni a testo: campi del backlog e cerimonie. */
function sectionRows(title) {
  const start = lines.findIndex((line) => line.startsWith(`## ${title}`));
  if (start === -1) return [];

  const after = lines.findIndex((line, index) => index > start && line.startsWith("## "));

  return lines
    .slice(start, after === -1 ? lines.length : after)
    .filter(
      (row) =>
        /^\| /.test(row) && !/^\|\s*-+/.test(row) && !/^\| (Campo|Elemento) /.test(row),
    )
    .map((row) => ({ id: /^\| ([^|]+?)\s*\|/.exec(row)[1], status: statusOf(row) }));
}

const all = [
  ...rows,
  ...sectionRows("7. Il product backlog"),
  ...sectionRows("8. Cerimonie e operatività"),
];

const work = all.filter((row) => row.status !== "non è sviluppo");

if (work.length === 0) {
  console.error(`nessuna voce trovata in ${MAP}: la mappa è cambiata di forma?`);
  process.exit(1);
}

const tally = new Map();
for (const row of work) tally.set(row.status, [...(tally.get(row.status) ?? []), row.id]);

const share = (count) => `${Math.round((count / work.length) * 1000) / 10}%`;

console.log(`Fedeltà al libro, secondo ${MAP}\n`);
console.log(`${work.length} voci che sono lavoro di sviluppo`);
console.log(`${all.length - work.length} escluse: regole per le persone, non software\n`);

for (const status of ["fatto", "parziale", "da fare", "bloccato"]) {
  const ids = tally.get(status) ?? [];
  if (ids.length === 0) continue;

  console.log(`${status.padEnd(9)} ${String(ids.length).padStart(2)} ${share(ids.length).padStart(6)}`);
  console.log(`          ${ids.join(", ")}\n`);
}

const done = (tally.get("fatto") ?? []).length;
const partial = (tally.get("parziale") ?? []).length;
const left = work.length - done;

/*
 * Due percentuali, non una.
 *
 * Una voce «parziale» non è né fatta né da fare, e schiacciarla su un lato
 * produce un numero che sembra più preciso di quanto sia. Dichiarare entrambi
 * gli estremi dice la stessa cosa senza fingere una precisione che non c'è.
 */
console.log(`Fatto per intero:  ${done}/${work.length} = ${share(done)}`);
console.log(`Resta da fare:     fra ${share(left - partial / 2)} e ${share(left)}`);
console.log(`                   (${left} voci, di cui ${partial} già cominciate)`);
