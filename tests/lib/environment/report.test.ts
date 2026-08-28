import { describe, expect, it } from "vitest";

import { custodyDetail, environmentReport } from "@/lib/environment/report";

/**
 * Il rapporto sull'ambiente del server.
 *
 * La verifica che conta non è che l'elenco sia giusto — quello si legge — ma
 * che **nessun valore** finisca nel risultato. Una pagina che dice «ecco cosa
 * ho nell'ambiente» è a un passo dallo stamparne il contenuto, e il passo lo si
 * fa per comodità, di solito mentre si cerca un guasto.
 */

const CHIAVE_VALIDA = Buffer.alloc(32, 7).toString("base64");

const COMPLETO = {
  DATABASE_URL: "postgresql://utente:parola@host/db",
  AUTH_SECRET: "un-segreto-di-sessione",
  SECRETS_KEY: CHIAVE_VALIDA,
  AUTH_GITHUB_ID: "id",
  AUTH_GITHUB_SECRET: "segreto-oauth",
  JOB_SECRET: "segreto-dei-job",
};

describe("che cosa vede il server", () => {
  it("non riporta mai il valore di una variabile", () => {
    /*
     * La regola che rende questa pagina mostrabile a qualcuno.
     *
     * Ogni valore qui sotto è riconoscibile: se uno solo comparisse nel
     * risultato, questo test cadrebbe. È una verifica sulla **forma** del
     * rapporto, non sulle intenzioni di chi lo scrive.
     */
    const serialised = JSON.stringify(environmentReport(COMPLETO));

    for (const valore of Object.values(COMPLETO)) {
      expect(serialised).not.toContain(valore);
    }
  });

  it("elenca ciò che si aspetta, non ciò che trova", () => {
    /*
     * Costruire l'elenco da `process.env` stamperebbe l'intero ambiente della
     * piattaforma — decine di variabili che non ci riguardano, e alcune che non
     * vanno guardate.
     */
    const report = environmentReport({ ...COMPLETO, UNA_COSA_DELLA_PIATTAFORMA: "x" });

    expect(report.entries.some((entry) => entry.name === "UNA_COSA_DELLA_PIATTAFORMA")).toBe(
      false,
    );
    expect(report.entries.some((entry) => entry.name === "SECRETS_KEY")).toBe(true);
  });

  it("non nomina le variabili del modello, che non configurano più nulla", () => {
    // Mostrarle rimetterebbe in circolo l'idea che il modello si scelga da un
    // pannello di hosting: dopo ADR-0010 lo sceglie il progetto (PR #75).
    const report = environmentReport({ ...COMPLETO, LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    const nomi = report.entries.map((entry) => entry.name);

    expect(nomi).not.toContain("LLM_PROVIDER");
    expect(nomi).not.toContain("GEMINI_API_KEY");
  });

  it("con tutto a posto non segnala problemi", () => {
    expect(environmentReport(COMPLETO).problems).toBe(0);
  });

  it("conta solo le necessarie fra i problemi", () => {
    // Un contatore che includesse le facoltative direbbe «3 problemi» a
    // un'installazione che funziona, e un allarme sempre acceso non è un
    // allarme.
    const { AUTH_GITHUB_ID: _a, AUTH_GITHUB_SECRET: _b, JOB_SECRET: _c, ...senzaOpzionali } =
      COMPLETO;

    expect(environmentReport(senzaOpzionali).problems).toBe(0);
  });

  it("distingue una chiave di custodia assente da una incollata male", () => {
    /*
     * La distinzione per cui questa pagina è nata. «Non l'ho messa» e «l'ho
     * messa male» richiedono due gesti diversi, e finché producevano la stessa
     * riga si ripeteva il primo all'infinito.
     */
    const assente = environmentReport({ ...COMPLETO, SECRETS_KEY: "" });
    const rotta = environmentReport({ ...COMPLETO, SECRETS_KEY: Buffer.alloc(31).toString("base64") });

    expect(assente.entries.find((entry) => entry.name === "SECRETS_KEY")?.state).toBe("absent");
    expect(rotta.entries.find((entry) => entry.name === "SECRETS_KEY")?.state).toBe("invalid");
    expect(rotta.problems).toBe(1);
  });

  it("dice che cosa succede senza, non solo che manca", () => {
    // «SECRETS_KEY: assente» lascia al lettore il compito di sapere a che cosa
    // serve. La conseguenza è l'informazione su cui si può agire (R6).
    const senzaCustodia = environmentReport({ ...COMPLETO, SECRETS_KEY: "" });
    const voce = senzaCustodia.entries.find((entry) => entry.name === "SECRETS_KEY");

    expect(voce?.consequence).toContain("Chiave API");
  });

  it("non allega una conseguenza a ciò che è a posto", () => {
    const voce = environmentReport(COMPLETO).entries.find((e) => e.name === "SECRETS_KEY");
    expect(voce?.consequence).toBeNull();
  });
});

describe("il dettaglio sulla chiave incollata male", () => {
  it("dice quanti byte ha trovato", () => {
    expect(custodyDetail({ SECRETS_KEY: Buffer.alloc(20).toString("base64") })).toContain(
      "20 byte",
    );
  });

  it("tace quando la chiave è a posto o manca del tutto", () => {
    // Se manca, il posto giusto per dirlo è la riga del rapporto: qui
    // aggiungerebbe rumore a un caso già chiaro.
    expect(custodyDetail({ SECRETS_KEY: CHIAVE_VALIDA })).toBeNull();
    expect(custodyDetail({})).toBeNull();
  });

  it("non riporta il valore nemmeno qui", () => {
    const chiave = Buffer.alloc(20, 3).toString("base64");
    expect(custodyDetail({ SECRETS_KEY: chiave })).not.toContain(chiave);
  });
});
