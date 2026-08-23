import {
  SPRINT_REPORT_BUDGET,
  generateSprintReport,
  type GenerateOutcome,
} from "@/agents/sprint-report";
import { createGateway, selectedProvider } from "@/lib/llm";

import { GOLDEN_DATASET, type EvalCase } from "./dataset";
import { evaluate, type PropertyResult } from "./properties";

/**
 * Runs the golden dataset against whichever provider the environment selects.
 *
 * **What this measures that the test suite cannot.** The unit tests prove the
 * runtime refuses a bad answer; they say nothing about how often a real model
 * produces one. That number is the health of the prompt, and it only moves when
 * somebody edits the prompt — which is exactly when you want to be told.
 *
 * Never part of `npm run verify`. It reaches a vendor, so it costs money and
 * fails when a free tier is throttled, and a pipeline that a rate limit can turn
 * red is a pipeline people learn to ignore.
 */

type CaseReport = {
  readonly testCase: EvalCase;
  readonly outcome: GenerateOutcome;
  readonly properties: readonly PropertyResult[];
  /** True when the runtime refused the answer before any property was checked. */
  readonly refused: boolean;
};

async function runCase(testCase: EvalCase): Promise<CaseReport> {
  const outcome = await generateSprintReport({
    gateway: createGateway(),
    snapshot: testCase.snapshot,
    projectName: testCase.projectName,
    language: "it",
    maxTokens: SPRINT_REPORT_BUDGET,
  });

  if (!outcome.ok) return { testCase, outcome, properties: [], refused: true };

  return {
    testCase,
    outcome,
    properties: evaluate(testCase, outcome.report.content),
    refused: false,
  };
}

function describe(report: CaseReport): boolean {
  const failures = report.properties.filter((property) => !property.held);
  const passed = !report.refused && failures.length === 0;

  process.stdout.write(`${passed ? "  ok  " : "  NO  "}${report.testCase.name}\n`);

  if (report.refused && !report.outcome.ok) {
    /*
     * A refusal is not the same kind of failure as a broken property.
     *
     * The guard did its job — nothing wrong reached a reader — but the model
     * needed the guard, and how often that happens is the number this runner
     * exists to report.
     */
    process.stdout.write(`        rifiutato dal runtime: ${report.outcome.message}\n`);
    process.stdout.write(`        perché conta: ${report.testCase.purpose}\n`);
    return false;
  }

  for (const failure of failures) {
    process.stdout.write(`        ✗ ${failure.name}${failure.detail ? `: ${failure.detail}` : ""}\n`);
  }

  if (failures.length > 0) {
    process.stdout.write(`        perché conta: ${report.testCase.purpose}\n`);
  }

  return passed;
}

async function main(): Promise<void> {
  const provider = selectedProvider();

  /*
   * The deterministic stub answers the same thing forever, so evaluating it
   * measures nothing about a model. The escape hatch exists for a different
   * question — whether this runner works — and says so, because a run that
   * printed results from a stub would look like an evaluation and not be one.
   */
  const allowFake = process.env["EVAL_ALLOW_FAKE"] === "1";

  if (provider === "fake" && !allowFake) {
    process.stdout.write(
      [
        "Il fornitore selezionato è `fake`, che restituisce sempre la stessa risposta.",
        "Valutare un modello deterministico non misura nulla: imposta LLM_PROVIDER e la",
        "chiave corrispondente (GEMINI_API_KEY o GROQ_API_KEY) per eseguire le eval.",
        "",
        "Per provare il funzionamento del runner stesso, e non del modello:",
        "EVAL_ALLOW_FAKE=1 npm run eval",
        "",
      ].join("\n"),
    );
    return;
  }

  if (provider === "fake") {
    process.stdout.write(
      "ATTENZIONE: fornitore `fake`. Questa è una prova del runner, non una valutazione.\n\n",
    );
  }

  process.stdout.write(`Valutazione degli output — fornitore: ${provider}\n\n`);

  const reports: CaseReport[] = [];
  for (const testCase of GOLDEN_DATASET) {
    // In sequenza e non in parallelo: i piani gratuiti limitano la frequenza, e
    // una eval che fallisce per throttling non dice nulla sul prompt.
    reports.push(await runCase(testCase));
  }

  const passed = reports.map(describe).filter(Boolean).length;
  const refused = reports.filter((report) => report.refused).length;

  process.stdout.write(
    `\n${passed}/${reports.length} casi superati, ${refused} rifiutati dal runtime\n`,
  );

  if (passed < reports.length) process.exitCode = 1;
}

/*
 * An explicit `main()` rather than a top-level `await`, matching `scripts/`:
 * the loader compiles a plain `.ts` to CommonJS, where top-level await does not
 * exist. The failure is a build error, not a runtime one, so it would only be
 * discovered by someone trying to run the evals.
 */
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
