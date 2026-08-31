import { describe, expect, it } from "vitest";

import { createJiraReader, type JiraCredentials } from "@/connectors/jira/client";
import { jiraConfigSchema } from "@/connectors/jira";
import { organizationIdSchema, projectIdSchema } from "@/domain";

/**
 * Il client HTTP, senza rete.
 *
 * §6 vieta ai test dei connettori le chiamate vere, e il divieto deve valere
 * anche — soprattutto — per la parte il cui mestiere è chiamare. Il `fetch` è
 * un argomento, quindi qui è una funzione che risponde da una tabella.
 *
 * Ciò che si verifica non è «la rete funziona»: è che il client **chieda le cose
 * giuste** e **si comporti bene quando gli viene detto di aspettare**.
 */

const CONFIG = jiraConfigSchema.parse({
  siteUrl: "https://esempio.atlassian.net",
  projectKey: "SMAI",
  boardId: 7,
  stateMapping: { "To Do": "todo", Done: "done" },
});

const CREDENTIALS: JiraCredentials = {
  email: "chi@example.invalid",
  apiToken: "token-finto",
};

const OPTIONS = {
  organizationId: organizationIdSchema.parse("3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21"),
  projectId: projectIdSchema.parse("9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905"),
  asOf: new Date("2026-08-19T10:00:00.000Z"),
};

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/** The smallest instance that answers every call the reader makes. */
function stubRoutes(): Record<string, unknown> {
  return {
    "/rest/api/3/field": [
      { id: "customfield_10016", name: "Story Points" },
      { id: "customfield_10020", name: "Sprint" },
    ],
    "/rest/agile/1.0/board/7": { name: "SMAI board" },
    "/rest/agile/1.0/board/7/sprint": { isLast: true, values: [] },
    "/rest/api/3/search/jql": { issues: [] },
  };
}

function readerWith(
  handler: (url: string, calls: string[]) => Response,
): { readonly read: ReturnType<typeof createJiraReader>; readonly calls: string[] } {
  const calls: string[] = [];

  const read = createJiraReader({
    config: CONFIG,
    credentials: CREDENTIALS,
    httpFetch: (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      return handler(url, calls);
    }) as typeof fetch,
    sleep: async () => undefined,
  });

  return { read, calls };
}

function routed(routes: Record<string, unknown>) {
  return (url: string): Response => {
    const path = url.replace("https://esempio.atlassian.net", "");

    for (const [prefix, body] of Object.entries(routes)) {
      if (path.startsWith(prefix)) return reply(body);
    }

    return reply({ errorMessages: [`nessuna rotta per ${path}`] }, 404);
  };
}

describe("client Jira — che cosa chiede", () => {
  it("chiede il backlog nell'ordine del backlog", async () => {
    /*
     * Jira ordina con una stringa opaca che ha senso solo nel confronto: non
     * c'è un numero da leggere su ciascuna issue. Senza `ORDER BY Rank` la
     * posizione in backlog sarebbe l'ordine in cui il database ha risposto,
     * cioè nessun ordine.
     */
    const { read, calls } = readerWith(routed(stubRoutes()));

    await read(OPTIONS);

    const search = calls.find((url) => url.includes("/search/jql"));
    expect(decodeURIComponent(search ?? "")).toContain("ORDER BY Rank ASC");
  });

  it("sfoglia le issue con il token di pagina, non con startAt", async () => {
    /*
     * Il guasto che questo test blocca, e che nessun test poteva vedere prima.
     *
     * `/rest/api/3/search/jql` è l'endpoint nuovo di Jira Cloud e **non conosce
     * `startAt`**: si sfoglia con il `nextPageToken` che ogni risposta porta con
     * sé. Passargli `startAt` non produce un errore — lo ignora, e restituisce
     * ogni volta la stessa prima pagina.
     *
     * È invisibile sotto le cento issue, cioè su ogni risposta registrata e su
     * ogni progetto di prova. Su un progetto vero sarebbe un ciclo che non
     * finisce, o cento elementi ripetuti all'infinito.
     */
    const pagina = (chiave: string) => ({
      id: chiave,
      key: chiave,
      fields: {
        summary: `Elemento ${chiave}`,
        created: "2026-08-01T09:00:00.000Z",
        updated: "2026-08-01T09:00:00.000Z",
        issuetype: { name: "Story" },
        status: { name: "To Do", statusCategory: { key: "new" } },
      },
    });

    const { read, calls } = readerWith((url) => {
      // Ogni issue porta con sé una seconda chiamata per il changelog: senza
      // questa rotta il test fallirebbe per una ragione che non è quella che
      // sta verificando.
      if (url.includes("/changelog")) return reply({ isLast: true, values: [] });
      if (!url.includes("/search/jql")) return routed(stubRoutes())(url);

      return url.includes("nextPageToken=seconda")
        ? reply({ issues: [pagina("SMAI-2")], isLast: true })
        : reply({ issues: [pagina("SMAI-1")], nextPageToken: "seconda" });
    });

    const snapshot = await read(OPTIONS);

    const searches = calls.filter((url) => url.includes("/search/jql"));
    expect(searches).toHaveLength(2);
    expect(searches[0]).not.toContain("startAt");
    expect(searches[1]).toContain("nextPageToken=seconda");

    // La prova che conta: due pagine diverse, non la stessa due volte.
    expect(snapshot.issues.map((issue) => issue.key)).toEqual(["SMAI-1", "SMAI-2"]);
  });

  it("si ferma quando la risposta non porta un token, anche senza isLast", async () => {
    // La difesa contro una risposta che non si dichiara finita: senza token la
    // richiesta successiva ricomincerebbe da capo, all'infinito.
    const { read, calls } = readerWith((url) =>
      url.includes("/search/jql") ? reply({ issues: [] }) : routed(stubRoutes())(url),
    );

    await read(OPTIONS);

    expect(calls.filter((url) => url.includes("/search/jql"))).toHaveLength(1);
  });

  it("su una richiesta incrementale filtra per data di aggiornamento", async () => {
    const { read, calls } = readerWith(routed(stubRoutes()));

    await read({ ...OPTIONS, since: new Date("2026-08-01T09:30:00.000Z") });

    const search = calls.find((url) => url.includes("/search/jql"));
    expect(decodeURIComponent(search ?? "")).toContain('updated >= "2026-08-01 09:30"');
  });

  it("si autentica con il token, e il token non finisce nell'indirizzo", async () => {
    // Un segreto in una query string finisce nei log di ogni proxy attraversato.
    let authorization: string | null = null;

    const read = createJiraReader({
      config: CONFIG,
      credentials: CREDENTIALS,
      httpFetch: (async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).not.toContain("token-finto");
        const headers = new Headers(init?.headers);
        authorization = headers.get("Authorization");
        return routed(stubRoutes())(String(input));
      }) as typeof fetch,
      sleep: async () => undefined,
    });

    await read(OPTIONS);

    expect(authorization).toBe(
      `Basic ${Buffer.from("chi@example.invalid:token-finto", "utf8").toString("base64")}`,
    );
  });
});

describe("client Jira — quando gli viene detto di aspettare", () => {
  it("riprova dopo un 429, invece di fallire", async () => {
    let refusals = 0;

    const { read, calls } = readerWith((url) => {
      if (url.includes("/rest/api/3/field") && refusals === 0) {
        refusals += 1;
        return reply({ message: "troppo traffico" }, 429, { "Retry-After": "2" });
      }

      return routed(stubRoutes())(url);
    });

    await read(OPTIONS);

    expect(refusals).toBe(1);
    expect(calls.filter((url) => url.includes("/rest/api/3/field"))).toHaveLength(2);
  });

  it("smette di riprovare invece di girare per sempre", async () => {
    // Un tentativo senza fine trasformerebbe una quota mal configurata in un
    // job che non finisce e non segnala: il peggiore dei due fallimenti,
    // perché nessuno viene avvisato.
    const { read } = readerWith(() => reply({}, 429, { "Retry-After": "1" }));

    await expect(read(OPTIONS)).rejects.toThrow("429");
  });

  it("dice quale chiamata è fallita e con quale codice", async () => {
    const { read } = readerWith(() => reply({ errorMessages: ["no"] }, 401));

    await expect(read(OPTIONS)).rejects.toThrow("/rest/api/3/field");
  });
});

describe("client Jira — quello che Jira manda davvero", () => {
  it("appiattisce il testo ricco in testo semplice", async () => {
    /*
     * L'API v3 restituisce le descrizioni come un albero di nodi, non come una
     * stringa. Il portale non ha uso della formattazione — il testo è **dato**
     * (§8.1) — ma leggere solo il primo livello perderebbe in silenzio quasi
     * tutta una descrizione, perché il formato annida.
     */
    const routes = {
      ...stubRoutes(),
      "/rest/api/3/search/jql": {
        issues: [
          {
            id: "10001",
            key: "SMAI-1",
            fields: {
              summary: "Pagamento",
              created: "2026-04-01T09:00:00.000+0000",
              updated: "2026-04-01T09:00:00.000+0000",
              issuetype: { name: "Story" },
              status: { name: "To Do", statusCategory: { key: "new" } },
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Paga con " }],
                  },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          { type: "paragraph", content: [{ type: "text", text: "carta" }] },
                        ],
                      },
                    ],
                  },
                ],
              },
              customfield_10020: [{ id: 12 }],
            },
          },
        ],
      },
      "/rest/api/3/issue/SMAI-1/changelog": { isLast: true, values: [] },
    };

    const { read } = readerWith(routed(routes));

    const snapshot = await read(OPTIONS);

    expect(snapshot.issues[0]?.fields.description).toContain("Paga con");
    expect(snapshot.issues[0]?.fields.description).toContain("carta");
  });

  it("legge gli sprint dal campo personalizzato, qualunque forma abbia", async () => {
    const routes = {
      ...stubRoutes(),
      "/rest/api/3/search/jql": {
        issues: [
          {
            id: "10001",
            key: "SMAI-1",
            fields: {
              summary: "Pagamento",
              created: "2026-04-01T09:00:00.000+0000",
              updated: "2026-04-01T09:00:00.000+0000",
              issuetype: { name: "Story" },
              status: { name: "To Do", statusCategory: { key: "new" } },
              // Le istanze vecchie scrivono una stringa, le nuove un oggetto.
              customfield_10020: [{ id: 12 }, "com.atlassian.greenhopper[id=13,state=ACTIVE]"],
            },
          },
        ],
      },
      "/rest/api/3/issue/SMAI-1/changelog": { isLast: true, values: [] },
    };

    const { read } = readerWith(routed(routes));

    const snapshot = await read(OPTIONS);

    expect(snapshot.issues[0]?.fields.sprintIds).toEqual([12, 13]);
  });
});
