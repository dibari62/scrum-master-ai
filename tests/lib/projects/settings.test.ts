import { describe, expect, it } from "vitest";

import {
  mayConfigureSettings,
  parseSettingsForm,
  parseStateMapping,
  renderStateMapping,
} from "@/lib/projects/settings";

/**
 * La lettura del modulo delle impostazioni.
 *
 * Due famiglie di verifiche, e la seconda vale più della prima: che una
 * credenziale non si perda, e che la corrispondenza fra gli stati Jira e i nostri
 * venga letta com'è scritta. Sbagliare la seconda non produce un errore, produce
 * un numero plausibile e falso.
 */

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

const MINIMO = { brainProvider: "fake" };

describe("chi può cambiare le impostazioni", () => {
  it("solo proprietario e amministratore", () => {
    // Qui non è una questione di ordine: queste impostazioni contengono la
    // credenziale con cui un'azienda paga.
    expect(mayConfigureSettings("owner")).toBe(true);
    expect(mayConfigureSettings("admin")).toBe(true);
    expect(mayConfigureSettings("member")).toBe(false);
    expect(mayConfigureSettings(null)).toBe(false);
    expect(mayConfigureSettings(undefined)).toBe(false);
  });
});

describe("una credenziale non si perde per distrazione", () => {
  it("un campo lasciato vuoto non cancella la chiave memorizzata", () => {
    /*
     * **La verifica più importante del file.**
     *
     * Il modulo non mostra mai la chiave — non può, §8.3 — quindi non può
     * rimandarla indietro. Se il vuoto significasse «cancellala», cambiare il
     * nome del modello cancellerebbe la credenziale, e la prima esecuzione
     * fallirebbe per una ragione che non ha niente a che vedere con ciò che è
     * stato fatto.
     */
    const parsed = parseSettingsForm(form({ ...MINIMO, brainApiKey: "" }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.input.brainApiKey).toBeUndefined();
  });

  it("cancellare richiede un gesto apposta", () => {
    const parsed = parseSettingsForm(
      form({ ...MINIMO, brainApiKey: "", "brainApiKey-rimuovi": "on" }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.input.brainApiKey).toBeNull();
  });

  it("la richiesta di rimozione vince su un valore digitato per sbaglio", () => {
    // Chi ha spuntato «rimuovi» ha espresso l'intenzione più recente e più
    // esplicita delle due.
    const parsed = parseSettingsForm(
      form({ ...MINIMO, brainApiKey: "chiave-nuova", "brainApiKey-rimuovi": "on" }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.input.brainApiKey).toBeNull();
  });

  it("una chiave scritta sostituisce quella memorizzata", () => {
    const parsed = parseSettingsForm(form({ ...MINIMO, brainApiKey: "  chiave-nuova  " }));

    expect(parsed.ok).toBe(true);
    // Ripulita dagli spazi: una chiave incollata da una pagina web se li porta
    // dietro, e il fornitore la rifiuterebbe senza dire perché.
    if (parsed.ok) expect(parsed.input.brainApiKey).toBe("chiave-nuova");
  });
});

describe("la configurazione Jira", () => {
  const JIRA = {
    connector: "jira",
    jiraSiteUrl: "https://esempio.atlassian.net",
    jiraProjectKey: "SMAI",
    jiraBoardId: "7",
    jiraStateMapping: "To Do = todo\nDone = done",
    brainProvider: "fake",
  };

  it("legge una configurazione completa", () => {
    const parsed = parseSettingsForm(form(JIRA));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.connector).toBe("jira");
      expect(parsed.input.connectorConfig["projectKey"]).toBe("SMAI");
      expect(parsed.input.connectorConfig["boardId"]).toBe(7);
    }
  });

  it("rifiuta un indirizzo che non è un indirizzo", () => {
    const parsed = parseSettingsForm(form({ ...JIRA, jiraSiteUrl: "laMiaAzienda" }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((error) => error.field === "jiraSiteUrl")).toBe(true);
    }
  });

  it("rifiuta un numero di board che non è un numero", () => {
    const parsed = parseSettingsForm(form({ ...JIRA, jiraBoardId: "la board di Anna" }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((error) => error.field === "jiraBoardId")).toBe(true);
    }
  });

  it("riporta tutti i problemi insieme, non uno alla volta", () => {
    /*
     * Un modulo che rifiuta un campo per volta obbliga a inviare quattro volte
     * per scoprire quattro errori — e ogni invio è un'occasione per ridigitare
     * male una chiave.
     */
    const parsed = parseSettingsForm(
      form({ ...JIRA, jiraSiteUrl: "sbagliato", jiraBoardId: "no", jiraProjectKey: "" }),
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("non legge la configurazione Jira se il connettore è un altro", () => {
    // Conservare campi Jira su un progetto passato al connettore sintetico
    // lascerebbe in giro una configurazione che nessuno crede più attiva.
    const parsed = parseSettingsForm(form({ ...JIRA, connector: "seed" }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.input.connectorConfig).toEqual({});
  });
});

describe("la corrispondenza fra gli stati", () => {
  it("legge una riga per stato", () => {
    const errors: { field: string; message: string }[] = [];
    const mapping = parseStateMapping("To Do = todo\nIn Progress = in_progress", errors);

    expect(mapping).toEqual({ "To Do": "todo", "In Progress": "in_progress" });
    expect(errors).toEqual([]);
  });

  it("regge nomi con spazi e maiuscole, che sono la norma", () => {
    const errors: { field: string; message: string }[] = [];
    const mapping = parseStateMapping("Ready for QA   =   in_review", errors);

    expect(mapping).toEqual({ "Ready for QA": "in_review" });
  });

  it("ignora le righe vuote invece di lamentarsene", () => {
    const errors: { field: string; message: string }[] = [];
    const mapping = parseStateMapping("\nTo Do = todo\n\n\nDone = done\n", errors);

    expect(Object.keys(mapping)).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("dice quale riga è sbagliata, non che «la mappatura non è valida»", () => {
    // «La riga 2 non ha un uguale» è qualcosa su cui una persona può agire.
    const errors: { field: string; message: string }[] = [];
    parseStateMapping("To Do = todo\nIn Progress in_progress", errors);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("Riga 2");
  });

  it("segnala una riga con un lato solo", () => {
    const errors: { field: string; message: string }[] = [];
    parseStateMapping("To Do =", errors);

    expect(errors[0]?.message).toContain("Riga 1");
  });

  it("si riscrive in ordine stabile, non nell'ordine in cui è stata scritta", () => {
    /*
     * La mappatura fa un giro attraverso una colonna `jsonb`, e `jsonb` **non
     * conserva l'ordine delle chiavi**: conserva un oggetto, non un documento.
     * Riscriverla nell'ordine in cui Postgres la restituisce farebbe rimescolare
     * la casella di testo fra una visita e l'altra — e sembrerebbe che il
     * portale modifichi la configurazione di qualcuno alle sue spalle.
     *
     * Alfabetico è arbitrario ma **stabile**, ed è la stabilità che conta.
     */
    const errors: { field: string; message: string }[] = [];
    const mapping = parseStateMapping("To Do = todo\nDone = done\nIn Progress = in_progress", errors);

    // L'ordine di scrittura era To Do, Done, In Progress.
    expect(renderStateMapping({ stateMapping: mapping })).toBe(
      "Done = done\nIn Progress = in_progress\nTo Do = todo",
    );
  });

  it("un ordine diverso in ingresso produce lo stesso testo in uscita", () => {
    const errors: { field: string; message: string }[] = [];

    const primo = parseStateMapping("To Do = todo\nDone = done", errors);
    const secondo = parseStateMapping("Done = done\nTo Do = todo", errors);

    expect(renderStateMapping({ stateMapping: primo })).toBe(
      renderStateMapping({ stateMapping: secondo }),
    );
  });

  it("uno stato Jira non valido per noi fa fallire la configurazione", () => {
    /*
     * `in_revisione` non è uno dei nostri sei stati. Accettarlo produrrebbe una
     * lettura in cui ogni transizione verso quella colonna sparisce — nessun
     * errore, un numero più basso, e nessuno che sappia perché.
     */
    const parsed = parseSettingsForm(
      form({
        connector: "jira",
        jiraSiteUrl: "https://esempio.atlassian.net",
        jiraProjectKey: "SMAI",
        jiraBoardId: "7",
        jiraStateMapping: "In Revisione = in_revisione",
        brainProvider: "fake",
      }),
    );

    expect(parsed.ok).toBe(false);
  });
});
