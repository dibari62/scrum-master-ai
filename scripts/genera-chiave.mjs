#!/usr/bin/env node
/**
 * Genera una chiave di custodia (`SECRETS_KEY`) e la mette negli appunti.
 *
 * ## Perché esiste, invece di una riga da copiare da una guida
 *
 * L'istruzione precedente era «esegui questo comando, poi incolla su Vercel», e
 * lasciava scoperte due domande legittime: *quale* valore sto incollando, e come
 * faccio a sapere che negli appunti c'è finito davvero.
 *
 * Un valore che non si vede e non si può verificare non è una procedura: è un
 * atto di fede. Questo script chiude entrambe le domande — conferma la forma di
 * ciò che ha generato, e con `--mostra` lo stampa, che è una scelta che spetta a
 * chi possiede il segreto.
 *
 * ## Chi può vedere questa chiave
 *
 * Il proprietario del progetto, sempre. **Un agente, mai**: un segreto stampato
 * a terminale finisce nella cronologia della shell, nello scrollback e — quando
 * alla tastiera c'è un assistente — nella trascrizione di una conversazione
 * inviata a terzi. Per questo il comportamento predefinito è passare dagli
 * appunti, e `--mostra` va chiesto apertamente.
 *
 * ## Che cos'è questa chiave
 *
 * 32 byte casuali in base64, che diventano 44 caratteri. È ciò con cui il
 * portale cifra le credenziali che i progetti inseriscono — token di Jira e
 * chiavi dei modelli — prima che tocchino il database (ADR-0010).
 *
 * Non va ricordata né trascritta: vive nelle variabili d'ambiente della
 * piattaforma. Va però **conservata**: cambiarla rende illeggibile tutto ciò che
 * è già stato cifrato con la precedente.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const KEY_BYTES = 32;

const mostra = process.argv.includes("--mostra");

const key = randomBytes(KEY_BYTES).toString("base64");

/**
 * Negli appunti, senza passare da stdout.
 *
 * Ogni sistema ha il proprio comando; se nessuno funziona non è un errore
 * fatale — lo script lo dice e offre `--mostra`, che è comunque una via.
 */
function toClipboard(value) {
  const candidates =
    process.platform === "win32"
      ? [["clip", []]]
      : process.platform === "darwin"
        ? [["pbcopy", []]]
        : [
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, { input: value });
    if (!result.error && result.status === 0) return true;
  }

  return false;
}

const copied = toClipboard(key);
const decoded = Buffer.from(key, "base64").length;

console.log("");
console.log("Chiave di custodia generata.");
console.log(`  forma:     ${key.length} caratteri base64 = ${decoded} byte`);
console.log(`  attesa:    44 caratteri = ${KEY_BYTES} byte`);
console.log(`  negli appunti: ${copied ? "sì" : "NO — usa --mostra per leggerla"}`);
console.log("");

if (mostra) {
  console.log("  valore:");
  console.log("");
  console.log(`    ${key}`);
  console.log("");
  console.log(
    "  Stampato perché l'hai chiesto. Resta nella cronologia del terminale:",
  );
  console.log("  chiudi la finestra quando hai finito di incollarlo.");
  console.log("");
} else {
  console.log("  Il valore non è stato stampato: un segreto a terminale resta");
  console.log("  nella cronologia della shell. Incollalo con Ctrl+V.");
  console.log("  Per vederlo comunque: npm run chiave -- --mostra");
  console.log("");
}

console.log("Dove va:");
console.log("  Vercel -> il tuo progetto -> Settings -> Environment Variables");
console.log("");
console.log("  Key:          SECRETS_KEY");
console.log("  Environments: Production, Preview, Development");
console.log("  Type:         indifferente, Secret o Config");
console.log("");
console.log("  Il tipo non conta più: il portale legge le variabili dall'oggetto");
console.log("  del processo, quindi anche una Secret — disponibile solo al runtime");
console.log("  e non durante la build — arriva valorizzata. Prima non era così, e");
console.log("  una Secret finiva congelata a vuoto nel pacchetto compilato.");
console.log("");
console.log("Poi **rilancia il deploy**: le variabili si leggono all'avvio.");
console.log("Verifica su /organizzazione/ambiente: deve dire «valorizzata».");
console.log("");
