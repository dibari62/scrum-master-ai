import tls from "node:tls";

/**
 * Diagnoses a TLS failure towards a host, and names the culprit.
 *
 * **Why this exists.** Every connection to Neon failed with a certificate
 * error, and the tempting fix — `NODE_TLS_REJECT_UNAUTHORIZED=0` — disables
 * certificate validation for the whole process. That is not a workaround, it is
 * turning off the check that makes the connection worth anything.
 *
 * This script prints the certificate chain and, crucially, *who issued it*. A
 * corporate proxy re-signing traffic appears as an issuer that is not a public
 * certificate authority — on this machine, Cisco Umbrella. Once the cause has a
 * name the real fix follows: `node --use-system-ca`, which tells Node to trust
 * the operating system store, where the company certificate is already
 * installed. Validation stays on.
 *
 * Read-only. No credentials involved.
 *
 *   node scripts/diagnose-tls.mjs <host>
 *   node scripts/diagnose-tls.mjs ep-xxxx-pooler.eu-central-1.aws.neon.tech
 */

const host = process.argv[2];

if (!host) {
  console.error("uso: node scripts/diagnose-tls.mjs <host>");
  process.exit(2);
}

const socket = tls.connect(
  {
    host,
    port: 443,
    servername: host,
    /*
     * Validation is switched off **for the inspection only**, and this is the
     * one place where that is legitimate.
     *
     * With validation on, a failing handshake aborts before the certificate can
     * be read — the script would fail in exactly the case it exists to explain,
     * which is what the first version did. Nothing is transmitted here: the
     * connection is opened, the chain is read, the result is reported honestly
     * including whether it would have validated, and the socket is closed.
     *
     * Doing the same thing to *send data* is a different act entirely, and it
     * is forbidden. That is why `NODE_TLS_REJECT_UNAUTHORIZED=0` never appears
     * anywhere in this project.
     */
    rejectUnauthorized: false,
  },
  () => {
    console.log(`connessione TLS a ${host} stabilita`);
    console.log(`  certificato valido: ${socket.authorized}`);
    console.log(`  errore:             ${socket.authorizationError ?? "(nessuno)"}`);
    console.log("");
    console.log("catena dei certificati:");

    let certificate = socket.getPeerCertificate(true);
    let depth = 0;
    const seen = new Set();

    // A self-signed root points at itself: without the guard this loops forever.
    while (certificate && !seen.has(certificate.fingerprint256) && depth < 6) {
      seen.add(certificate.fingerprint256);
      console.log(`  [${depth}] soggetto: ${certificate.subject?.CN ?? "?"}`);
      console.log(
        `      emesso da: ${certificate.issuer?.CN ?? "?"} (${certificate.issuer?.O ?? "?"})`,
      );
      certificate = certificate.issuerCertificate;
      depth += 1;
    }

    console.log("");
    if (socket.authorized) {
      console.log("Nessun problema: la catena è valida per questo processo.");
    } else {
      console.log("Se l'emittente in cima alla catena non è un'autorità pubblica,");
      console.log("il traffico è ispezionato da un proxy aziendale. Il rimedio è:");
      console.log("");
      console.log('  $env:NODE_OPTIONS = "--use-system-ca"');
      console.log("");
      console.log("che fa fidare Node del deposito certificati del sistema operativo,");
      console.log("dove il certificato aziendale è già installato. La verifica resta accesa.");
      console.log("NON usare NODE_TLS_REJECT_UNAUTHORIZED=0: quella la spegne.");
      process.exitCode = 1;
    }

    socket.end();
  },
);

socket.on("error", (error) => {
  console.log(`ERRORE: ${error.code ?? ""} ${error.message}`);
  process.exitCode = 1;
});
