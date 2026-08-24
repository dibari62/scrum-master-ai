import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { isKnownSkillKey, type SkillRunFailureCause } from "@/domain";
import {
  formatCostUsd,
  formatDuration,
  formatNumber,
  formatShortDateTime,
} from "@/lib/format";

import { runConfigurationCheckAction } from "../../actions";
import { SKILLS } from "../../labels";
import { loadRuns, loadScheda } from "../../scheda";

export const dynamic = "force-dynamic";

type PageProps = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Diario tecnico · ${slug} · Scrum Master AI` };
}

/**
 * Every failure says what happened **and what to do about it**.
 *
 * A cause code alone — `provider_not_configured` — is a fact about the system,
 * not help for the person reading it.
 */
const FAILURE_LABELS: Readonly<Record<SkillRunFailureCause, string>> = {
  budget_exceeded: "Richiesta oltre il budget di token",
  quota_exceeded: "Limite giornaliero di esecuzioni raggiunto",
  provider_not_configured: "Nessun fornitore configurato",
  provider_unavailable: "Il fornitore non ha risposto",
  rate_limited: "Il fornitore ha applicato un limite di frequenza",
  timeout: "Il fornitore non ha risposto in tempo",
  invalid_output: "La risposta non rispettava il formato atteso",
  agent_suspended: "Lo Scrum Master AI è sospeso",
};

/**
 * How many runs to show before stopping.
 *
 * The register had grown past twenty near-identical lines and took up more of
 * the card than everything a reader came for. It is a trace, not a feature: the
 * recent ones answer "did it work and what did it cost", and the rest answer
 * nothing anybody was asking.
 */
const RUNS_SHOWN = 10;

/** The execution trace. Deliberately the last screen. */
export default async function DiarioPage({ params }: PageProps) {
  const { slug } = await params;

  const { agent, canConfigure } = await loadScheda(slug);
  const runs = await loadRuns(slug);

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Serve a rispondere a due domande sole: <strong>ha funzionato</strong> e{" "}
        <strong>quanto è costato</strong>. È una traccia, ed è normale non guardarla mai.
      </p>

      <Card>
        <CardHeader>
          <h2 className="text-base leading-none font-semibold">
            {SKILLS["configuration-check"].name}
          </h2>
          <CardDescription>{SKILLS["configuration-check"].produces}</CardDescription>
        </CardHeader>
        <CardContent>
          {canConfigure ? (
            <form action={runConfigurationCheckAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="outline" disabled={agent.status === "suspended"}>
                Prova il collegamento
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground text-sm">
              Serve un ruolo di amministratore per eseguire una verifica.
            </p>
          )}
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            Nessuna esecuzione finora.
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="grid gap-2">
            {runs.slice(0, RUNS_SHOWN).map((run) => (
              <li key={run.id} className="rounded-lg border p-3" data-run>
                {/*
                 * L'esito va a capo, la durata resta leggibile: una causa di
                 * fallimento lunga («Il fornitore ha applicato un limite di
                 * frequenza») su schermo stretto spingeva la durata contro il
                 * bordo.
                 */}
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="text-sm font-medium">
                    {isKnownSkillKey(run.skillKey) ? SKILLS[run.skillKey].name : run.skillKey}
                    {" · "}
                    {run.status === "succeeded" ? "riuscita" : "fallita"}
                    {run.failureCause ? ` — ${FAILURE_LABELS[run.failureCause]}` : ""}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatDuration(run.durationMs)}
                  </span>
                </div>

                <p className="text-muted-foreground mt-1 text-xs">
                  {/*
                   * L'ora, non solo la data.
                   *
                   * Otto verifiche dello stesso giorno, con lo stesso fornitore
                   * e lo stesso numero di token, rendevano otto righe
                   * identiche: il registro sembrava mostrare lo stesso dato
                   * ripetuto invece di otto esecuzioni distinte.
                   */}
                  {run.skillKey} · {formatShortDateTime(run.startedAt)} ·{" "}
                  {run.provider === "fake"
                    ? "fornitore fittizio, nessuna chiamata reale"
                    : (run.provider ?? "nessun fornitore")}
                  {run.model && run.provider !== "fake" ? ` (${run.model})` : ""} ·{" "}
                  {formatNumber(run.inputTokens + run.outputTokens)} token ·{" "}
                  {formatCostUsd(run.estimatedCostUsd)}
                </p>
              </li>
            ))}
          </ul>

          {runs.length > RUNS_SHOWN ? (
            // Ciò che non si vede va detto, non fatto sparire.
            <p className="text-muted-foreground text-xs">
              Vengono mostrate le {formatNumber(RUNS_SHOWN)} esecuzioni più recenti su{" "}
              {formatNumber(runs.length)} conservate.
            </p>
          ) : null}
        </>
      )}

      <p className="text-muted-foreground text-xs">
        Il costo è calcolato in codice da un listino versionato nel repository, mai
        prodotto da un modello.
      </p>
    </div>
  );
}
