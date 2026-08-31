import { describe, expect, it } from "vitest";

import {
  mayConfigureSettings,
  parseCalendarForm,
  parseIdentityForm,
  parseSettingsForm,
  parseStateMapping,
  renderStateMapping,
  submittedValues,
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

const MINIMO = { brainProvider: "fake", sezione: "modello" };

describe("quello che si è scritto non si perde per un campo sbagliato", () => {
  /*
   * Il difetto che questi test bloccano è stato trovato **provando**, non da
   * una verifica: sbagliare un campo su otto svuotava gli altri sette, incluso
   * un token appena generato su Atlassian.
   */

  it("restituisce i campi inviati, per rimetterli nel modulo", () => {
    const submitted = submittedValues(
      form({
        jiraSiteUrl: "https://esempio.atlassian.net",
        jiraProjectKey: "SMAI",
        jiraBoardId: "7",
      }),
    );

    expect(submitted.values["jiraSiteUrl"]).toBe("https://esempio.atlassian.net");
    expect(submitted.values["jiraProjectKey"]).toBe("SMAI");
    expect(submitted.values["jiraBoardId"]).toBe("7");
  });

  it("non restituisce mai una credenziale", () => {
    /*
     * §8.3, un livello più in là della cifratura.
     *
     * Un `value` in un `input` finisce nell'HTML che il browser riceve:
     * rimandare la chiave per ricompilare il modulo sarebbe la stessa fuga che
     * la cifratura evita, fatta dove nessuno la cerca.
     */
    const submitted = submittedValues(
      form({ jiraProjectKey: "SMAI", connectorSecret: "token-vero", brainApiKey: "chiave-vera" }),
    );

    expect(submitted.values).not.toHaveProperty("connectorSecret");
    expect(submitted.values).not.toHaveProperty("brainApiKey");
    expect(JSON.stringify(submitted.values)).not.toContain("token-vero");
    expect(JSON.stringify(submitted.values)).not.toContain("chiave-vera");
  });

  it("dichiara che una credenziale è andata persa, invece di tacerlo", () => {
    // Chi ha appena copiato un token deve sapere che va riscritto, non
    // scoprirlo al salvataggio successivo quando la lettura fallisce.
    const submitted = submittedValues(form({ connectorSecret: "token-vero" }));

    expect(submitted.secretLost).toBe(true);
  });

  it("non dichiara una perdita quando non c'era nessuna credenziale", () => {
    // Un avviso che compare sempre è un avviso che nessuno legge.
    const submitted = submittedValues(form({ jiraProjectKey: "SMAI", connectorSecret: "" }));

    expect(submitted.secretLost).toBe(false);
  });
});

describe("le due metà si salvano senza toccarsi", () => {
  it("salvare il modello non nomina il connettore", () => {
    /*
     * **La verifica che giustifica la divisione in schede.**
     *
     * La schermata mostra connettore e modello separatamente, quindi arrivano
     * due invii distinti. Se il parser restituisse sempre entrambe le metà,
     * salvare il modello manderebbe un connettore vuoto — e cancellerebbe la
     * configurazione di Jira senza che nessuno l'abbia chiesto.
     *
     * Ciò che non è nominato deve restare `undefined`, che a valle significa
     * «lascia com'è».
     */
    const parsed = parseSettingsForm(
      form({ sezione: "modello", brainProvider: "openai", brainApiKey: "sk-nuova" }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.brainProvider).toBe("openai");
      expect("connector" in parsed.input).toBe(false);
      expect("connectorConfig" in parsed.input).toBe(false);
    }
  });

  it("salvare il connettore non nomina il modello", () => {
    const parsed = parseSettingsForm(
      form({
        sezione: "dati",
        connector: "jira",
        jiraSiteUrl: "https://esempio.atlassian.net",
        jiraProjectKey: "SMAI",
        jiraBoardId: "7",
        jiraStateMapping: "To Do = todo",
        jiraAccountEmail: "scrum@esempio.it",
      }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.connector).toBe("jira");
      expect("brainProvider" in parsed.input).toBe(false);
    }
  });

  it("senza sezione dichiarata legge entrambe le metà", () => {
    // Il comportamento di prima, che resta valido per un chiamante che ha
    // davvero tutto — un caricamento iniziale, o un test.
    const parsed = parseSettingsForm(form({ connector: "seed", brainProvider: "fake" }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.connector).toBe("seed");
      expect(parsed.input.brainProvider).toBe("fake");
    }
  });
});

describe("il calendario lavorativo", () => {
  const calendario = (values: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) for (const entry of value) data.append(key, entry);
      else data.append(key, value);
    }
    return parseCalendarForm(data);
  };

  it("legge i giorni lavorativi e le festività", () => {
    const parsed = calendario({
      workingDays: ["monday", "tuesday", "wednesday"],
      holidays: "2026-08-15\n2026-12-25",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.calendar.workingDays).toEqual(["monday", "tuesday", "wednesday"]);
      expect(parsed.calendar.holidays).toEqual(["2026-08-15", "2026-12-25"]);
    }
  });

  it("rifiuta un calendario senza giorni lavorativi", () => {
    /*
     * Non è una configurazione insolita: è quella che rende ogni ciclo che
     * scorre i giorni o vuoto o infinito, a seconda di come è scritto.
     */
    const parsed = calendario({ holidays: "" });

    expect(parsed.ok).toBe(false);
  });

  it("dice quale riga è sbagliata, non che «il calendario non va bene»", () => {
    // «La riga 2 non è una data» è qualcosa su cui una persona può agire.
    const parsed = calendario({
      workingDays: ["monday"],
      holidays: "2026-08-15\n15 agosto\n2026-12-25",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors[0]?.message).toContain("Riga 2");
      expect(parsed.errors[0]?.message).toContain("15 agosto");
    }
  });

  it("ignora le righe vuote invece di lamentarsene", () => {
    const parsed = calendario({
      workingDays: ["monday"],
      holidays: "\n2026-08-15\n\n\n2026-12-25\n",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.calendar.holidays).toHaveLength(2);
  });

  it("non conserva due volte la stessa festività", () => {
    /*
     * Chi incolla due elenchi sovrapposti — le nazionali più quelle aziendali —
     * lo fa senza pensarci. Rifiutare il salvataggio sarebbe pedanteria;
     * contarla due volte gonfierebbe l'elenco a ogni salvataggio.
     */
    const parsed = calendario({
      workingDays: ["monday"],
      holidays: "2026-08-15\n2026-12-25\n2026-08-15",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.calendar.holidays).toEqual(["2026-08-15", "2026-12-25"]);
  });

  it("una settimana di sei giorni è legittima", () => {
    // Non tutte le squadre lavorano cinque giorni, e il modello non deve avere
    // un'opinione su quale sia la settimana giusta.
    const parsed = calendario({
      workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      holidays: "",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.calendar.workingDays).toHaveLength(6);
  });
});

describe("l'anagrafica del progetto", () => {
  it("legge nome e descrizione", () => {
    const parsed = parseIdentityForm(
      form({ name: "  Checkout  ", description: "  Il flusso di pagamento.  " }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.name).toBe("Checkout");
      expect(parsed.input.description).toBe("Il flusso di pagamento.");
    }
  });

  it("una descrizione vuota è assente, non una stringa vuota", () => {
    /*
     * Sono due affermazioni diverse: «non l'ho scritta» e «l'ho scritta vuota».
     * La seconda comparirebbe nell'elenco dei progetti come una riga di spazio
     * bianco sotto il nome.
     */
    const parsed = parseIdentityForm(form({ name: "Checkout", description: "   " }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.input.description).toBeNull();
  });

  it("un progetto è attivo finché non si spunta l'archiviazione", () => {
    const attivo = parseIdentityForm(form({ name: "Checkout" }));
    const archiviato = parseIdentityForm(form({ name: "Checkout", status: "archived" }));

    expect(attivo.ok && attivo.input.status).toBe("active");
    expect(archiviato.ok && archiviato.input.status).toBe("archived");
  });

  it("rifiuta un nome vuoto", () => {
    // Un progetto senza nome comparirebbe nell'elenco come una riga vuota
    // cliccabile.
    const parsed = parseIdentityForm(form({ name: "   " }));

    expect(parsed.ok).toBe(false);
  });
});

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
    jiraAccountEmail: "scrum@esempio.it",
    brainProvider: "fake",
  };

  it("legge una configurazione completa", () => {
    const parsed = parseSettingsForm(form(JIRA));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.connector).toBe("jira");
      expect(parsed.input.connectorConfig?.["projectKey"]).toBe("SMAI");
      expect(parsed.input.connectorConfig?.["boardId"]).toBe(7);
      expect(parsed.input.connectorConfig?.["accountEmail"]).toBe("scrum@esempio.it");
    }
  });

  it("pretende l'indirizzo dell'account, che è metà della credenziale", () => {
    /*
     * Jira autentica con la coppia indirizzo + token.
     *
     * Senza, la configurazione sembrerebbe completa e la prima lettura
     * tornerebbe 401 — mandando a controllare il token, che è l'unica cosa
     * giusta. Chiederlo qui costa un campo; non chiederlo costa un pomeriggio.
     */
    const { jiraAccountEmail: _omesso, ...senzaEmail } = JIRA;
    const parsed = parseSettingsForm(form(senzaEmail));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((error) => error.field === "jiraAccountEmail")).toBe(true);
    }
  });

  it("rifiuta un indirizzo di posta che non è un indirizzo", () => {
    const parsed = parseSettingsForm(form({ ...JIRA, jiraAccountEmail: "scrum-chiocciola" }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.some((error) => error.field === "jiraAccountEmail")).toBe(true);
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

describe("la frequenza della rilettura automatica", () => {
  /*
   * Ogni valore salvato qui si traduce in chiamate sulla quota Jira del
   * cliente. I casi che contano di più sono quelli in cui la frequenza **non**
   * deve cambiare senza che qualcuno l'abbia chiesto.
   */

  const dati = (values: Record<string, string>) =>
    parseSettingsForm(
      form({
        sezione: "dati",
        connector: "jira",
        jiraSiteUrl: "https://esempio.atlassian.net",
        jiraProjectKey: "SMAI",
        jiraAccountEmail: "chi@esempio.it",
        jiraBoardId: "7",
        jiraStateMapping: "To Do = todo\nDone = done",
        ...values,
      }),
    );

  it("legge la frequenza scelta", () => {
    const parsed = dati({ syncSchedule: "daily" });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("atteso salvataggio valido");
    expect(parsed.input.syncSchedule).toBe("daily");
  });

  it("non nomina la frequenza quando il modulo non la manda", () => {
    /*
     * `undefined` e non «manual»: un invio che non parla della frequenza deve
     * lasciarla com'era. Farlo diventare «manuale» spegnerebbe l'automatismo
     * di nascosto — e ci si accorgerebbe dopo giorni, guardando dati fermi.
     */
    const parsed = dati({});

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("atteso salvataggio valido");
    expect("syncSchedule" in parsed.input).toBe(false);
  });

  it("rifiuta un valore che non riconosce, invece di spegnere l'automatismo", () => {
    // Ripiegare su «manual» davanti a un valore inatteso sarebbe la stessa cosa
    // detta peggio: una schedulazione che sparisce senza dirlo.
    const parsed = dati({ syncSchedule: "ogni-tanto" });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("atteso rifiuto");
    expect(parsed.errors.some((error) => error.field === "syncSchedule")).toBe(true);
  });
});
