import { z } from "zod";

import type { FetchOptions } from "../contract";

import type { JiraConfig } from "./config";
import type { SnapshotReader } from "./index";
import {
  jiraChangelogEntrySchema,
  jiraFieldSchema,
  jiraSprintSchema,
  type JiraIssue,
  type JiraSnapshot,
} from "./types";

/**
 * The half that telephones.
 *
 * Everything about *what our numbers mean* lives in `translate.ts`, which is a
 * pure function. This file knows only how to obtain bytes: authenticate,
 * paginate, wait when told to wait, and hand over a snapshot.
 *
 * The separation is what makes the other half testable, and it also makes this
 * half honest about its own risks — each one is a named constant or a documented
 * branch rather than something buried inside a loop that also does arithmetic.
 *
 * **No secret is ever written here.** The credentials arrive as an argument and
 * come from the environment (§8.3).
 */

export type JiraCredentials = {
  /** The Atlassian account the token belongs to. */
  readonly email: string;
  readonly apiToken: string;
};

/**
 * How many times a rate-limited request is retried before giving up.
 *
 * Three, and then an error. An unbounded retry would turn a misconfigured quota
 * into a job that never ends and never reports — the worst of the two failures,
 * because nobody is told.
 */
const MAX_ATTEMPTS = 3;

/** Jira's ceiling on `maxResults` for the endpoints we read. */
const PAGE_SIZE = 100;

/**
 * Quante pagine si sfogliano prima di dichiarare che qualcosa non va.
 *
 * Centomila issue è molto oltre qualunque progetto reale, e serve solo a
 * distinguere «un progetto grande» da «una paginazione che non avanza» — che
 * senza un tetto sarebbe una richiesta appesa per sempre, cioè un guasto senza
 * messaggio.
 */
const MAX_PAGES = 1000;

/**
 * How long to wait when Jira asks to be left alone but does not say for how long.
 *
 * `Retry-After` is normally present on a `429`; when it is missing, waiting a
 * fixed second is better than retrying immediately, which would spend the
 * remaining quota on failures.
 */
const DEFAULT_RETRY_SECONDS = 1;

export type JiraReaderOptions = {
  readonly config: JiraConfig;
  readonly credentials: JiraCredentials;

  /**
   * The HTTP implementation, injected.
   *
   * So the client itself can be tested against recorded responses: §6 forbids
   * connector tests from making real calls, and that has to include the part
   * whose whole job is making calls.
   */
  readonly httpFetch?: typeof fetch;

  /** Injected for the same reason: a test must not actually sleep. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
};

const paginatedSchema = z.object({
  isLast: z.boolean().nullish(),
  total: z.number().nullish(),
  values: z.array(z.unknown()).nullish(),
});

export function createJiraReader(options: JiraReaderOptions): SnapshotReader {
  const get = createTransport(options);

  return async (fetchOptions: FetchOptions): Promise<JiraSnapshot> => {
    const fields = z
      .array(jiraFieldSchema)
      .parse(await get("/rest/api/3/field"))
      .map((field) => ({ id: field.id, name: field.name }));

    const sprintFieldId = fields.find((field) => field.name === "Sprint")?.id ?? null;

    const board = z
      .object({ name: z.string().min(1).default("Board") })
      .parse(await get(`/rest/agile/1.0/board/${options.config.boardId}`));

    const sprints = await readAllPages(get, (startAt) =>
      `/rest/agile/1.0/board/${options.config.boardId}/sprint?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
    ).then((values) => values.map((value) => jiraSprintSchema.parse(value)));

    const issues = await readIssues(get, options.config, fetchOptions, sprintFieldId);

    return { boardName: board.name, fields, sprints, issues: [...issues] };
  };
}

/**
 * Authentication, retry and error context — the part every call shares.
 *
 * Estratto perché ora esiste un secondo lettore (la sonda qui sotto) e le due
 * cose che vanno bene una volta sola sono l'intestazione di autenticazione e il
 * modo di comportarsi davanti a un `429`.
 */
function createTransport(options: JiraReaderOptions): (path: string) => Promise<unknown> {
  const httpFetch = options.httpFetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const authorization = `Basic ${Buffer.from(
    `${options.credentials.email}:${options.credentials.apiToken}`,
    "utf8",
  ).toString("base64")}`;

  const base = options.config.siteUrl.replace(/\/+$/, "");

  return async function get(path: string): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      const response = await httpFetch(`${base}${path}`, {
        headers: { Authorization: authorization, Accept: "application/json" },
      });

      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const header = Number(response.headers.get("Retry-After"));
        const seconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_SECONDS;

        await sleep(seconds * 1000);
        continue;
      }

      if (!response.ok) {
        // Con contesto: quale chiamata, quale codice. Un errore che dice solo
        // «richiesta fallita» costringe a rifare a mano il lavoro di capire.
        throw new Error(`Jira ha risposto ${response.status} a ${path}`);
      }

      return response.json();
    }
  };
}

/** Un progetto come lo vede l'account del token: quel tanto che basta a nominarlo. */
export type JiraProjectSummary = {
  readonly key: string;
  readonly name: string;
};

const projectSummarySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1).default("(senza nome)"),
});

/**
 * Quali progetti vede l'account del token.
 *
 * **Perché esiste.** Una lettura può riuscire e riportare zero elementi di
 * lavoro, e da quel solo fatto le tre cause possibili — progetto vuoto, chiave
 * sbagliata, account che non vede il progetto — sono indistinguibili. Questa
 * domanda le separa: se la chiave configurata compare nell'elenco, la chiave è
 * giusta e il progetto è verosimilmente vuoto; se non compare ma altre sì, la
 * chiave è sbagliata **e sappiamo quali sono quelle buone**; se l'elenco è
 * vuoto, il permesso è il problema.
 *
 * **È una lettura, e resta separata dal lettore principale**: non deve costare
 * nulla a chi sta leggendo un progetto che funziona, e un suo fallimento non
 * deve poter rovinare una sincronizzazione già riuscita.
 */
export function createJiraProbe(
  options: JiraReaderOptions,
): () => Promise<readonly JiraProjectSummary[]> {
  const get = createTransport(options);

  return async () => {
    /*
     * Una pagina sola, di proposito.
     *
     * Serve a nominare le chiavi in un messaggio d'errore, non a fare un
     * inventario: chi ha più di cento progetti su un sito non risolve il proprio
     * dubbio leggendo un elenco di cento nomi.
     */
    const page = z
      .object({ values: z.array(z.unknown()).nullish() })
      .parse(await get(`/rest/api/3/project/search?maxResults=${PAGE_SIZE}&orderBy=key`));

    return (page.values ?? []).map((value) => projectSummarySchema.parse(value));
  };
}

/** Walks a `startAt`/`isLast` paginated endpoint to the end. */
async function readAllPages(
  get: (path: string) => Promise<unknown>,
  path: (startAt: number) => string,
): Promise<readonly unknown[]> {
  const collected: unknown[] = [];

  for (let startAt = 0; ; startAt += PAGE_SIZE) {
    const page = paginatedSchema.parse(await get(path(startAt)));
    const values = page.values ?? [];

    collected.push(...values);

    // Due condizioni d'uscita, e servono entrambe: `isLast` è la risposta
    // ufficiale, una pagina più corta della richiesta è la difesa contro un
    // endpoint che non la manda e un ciclo che non finirebbe mai.
    if (page.isLast === true || values.length < PAGE_SIZE) return collected;
  }
}

const searchResultSchema = z.object({
  issues: z.array(z.unknown()).default([]),
  isLast: z.boolean().nullish(),
  nextPageToken: z.string().nullish(),
});

const rawIssueSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  fields: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Le issue del progetto, in ordine di backlog.
 *
 * **La paginazione qui è diversa da quella agile, e non per scelta nostra.**
 * `/rest/api/3/search/jql` è l'endpoint nuovo di Jira Cloud e **non conosce
 * `startAt`**: si sfoglia con un `nextPageToken` che ogni risposta porta con sé.
 * Passargli `startAt` non produce un errore — lo ignora e basta, restituendo
 * ogni volta la stessa prima pagina.
 *
 * È il guasto peggiore che una paginazione possa avere: invisibile sotto le
 * cento issue, e su un progetto vero un ciclo che non finisce o cento elementi
 * ripetuti all'infinito. Nessun test lo avrebbe mostrato, perché una risposta
 * registrata sta in una pagina sola.
 */
async function readIssues(
  get: (path: string) => Promise<unknown>,
  config: JiraConfig,
  options: FetchOptions,
  sprintFieldId: string | null,
): Promise<readonly JiraIssue[]> {
  /*
   * L'ordine è quello del backlog, e va chiesto.
   *
   * Jira ordina con una stringa opaca (`LexoRank`) che ha senso solo nel
   * confronto: non c'è un numero da leggere su ciascuna issue. Chiedendo
   * `ORDER BY Rank` la posizione N è la posizione N, e la traduzione può
   * limitarsi a contare.
   */
  const clauses = [`project = "${config.projectKey}"`];
  if (options.since) clauses.push(`updated >= "${jql(options.since)}"`);

  const jqlQuery = encodeURIComponent(`${clauses.join(" AND ")} ORDER BY Rank ASC`);

  const collected: JiraIssue[] = [];
  let token: string | null = null;

  /*
   * Un tetto alle pagine, che è una difesa e non una preferenza.
   *
   * Se un giorno l'endpoint smettesse di mandare `nextPageToken` senza
   * dichiararsi finito, il ciclo girerebbe per sempre dentro una richiesta
   * HTTP: un job appeso che non riporta nulla è peggio di un errore.
   */
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const path =
      `/rest/api/3/search/jql?jql=${jqlQuery}&maxResults=${PAGE_SIZE}&fields=*all` +
      (token === null ? "" : `&nextPageToken=${encodeURIComponent(token)}`);

    const result = searchResultSchema.parse(await get(path));

    for (const raw of result.issues) {
      const issue = rawIssueSchema.parse(raw);
      collected.push(await readIssue(get, issue, sprintFieldId));
    }

    /*
     * Due condizioni d'uscita, e servono entrambe. `isLast` è la risposta
     * ufficiale; l'assenza del token è la difesa contro una risposta che non la
     * manda — e senza token la richiesta successiva ricomincerebbe da capo.
     */
    if (result.isLast === true) return collected;

    token = result.nextPageToken ?? null;
    if (token === null) return collected;
  }

  throw new Error(
    `La ricerca su Jira ha superato ${MAX_PAGES} pagine: probabile paginazione che non avanza.`,
  );
}

const issueFieldsSchema = z.object({
  summary: z.string().default("(senza titolo)"),
  created: z.string().min(1),
  updated: z.string().min(1),
  issuetype: z.object({ name: z.string().min(1) }),
  status: z.object({
    name: z.string().min(1),
    statusCategory: z.object({ key: z.string().min(1) }).nullish(),
  }),
  assignee: z
    .object({
      accountId: z.string().min(1),
      displayName: z.string().default("Sconosciuto"),
      emailAddress: z.string().nullish(),
    })
    .nullish(),
  parent: z.object({ id: z.string().min(1) }).nullish(),
});

const commentContainerSchema = z.object({
  comments: z
    .array(
      z.object({
        id: z.string().min(1),
        author: z
          .object({
            accountId: z.string().min(1),
            displayName: z.string().default("Sconosciuto"),
            emailAddress: z.string().nullish(),
          })
          .nullish(),
        created: z.string().min(1),
        body: z.unknown(),
      }),
    )
    .default([]),
});

async function readIssue(
  get: (path: string) => Promise<unknown>,
  raw: { readonly id: string; readonly key: string; readonly fields: Record<string, unknown> },
  sprintFieldId: string | null,
): Promise<JiraIssue> {
  const fields = issueFieldsSchema.parse(raw.fields);

  const changelog = await readAllPages(
    get,
    (startAt) =>
      `/rest/api/3/issue/${raw.key}/changelog?startAt=${startAt}&maxResults=${PAGE_SIZE}`,
  ).then((values) => values.map((value) => jiraChangelogEntrySchema.parse(value)));

  const comments = commentContainerSchema.safeParse(raw.fields.comment);

  return {
    id: raw.id,
    key: raw.key,
    fields: {
      ...fields,
      description: plainText(raw.fields.description),
      sprintIds: sprintFieldId === null ? [] : [...sprintIds(raw.fields[sprintFieldId])],
    },
    customFields: raw.fields,
    changelog,
    comments: comments.success
      ? comments.data.comments.map((comment) => ({
          id: comment.id,
          author: comment.author ?? null,
          created: comment.created,
          body: plainText(comment.body) ?? "",
        }))
      : [],
  };
}

/**
 * The sprint field, whatever shape this instance stores it in.
 *
 * Modern Jira returns objects; older ones return strings like
 * `com.atlassian.greenhopper...[id=12,...]`. Only the identifiers are read, and
 * anything unrecognisable is dropped rather than guessed.
 */
function sprintIds(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];

  const ids: number[] = [];

  for (const entry of value) {
    if (typeof entry === "object" && entry !== null && "id" in entry) {
      const id = Number((entry as { id: unknown }).id);
      if (Number.isInteger(id)) ids.push(id);
      continue;
    }

    if (typeof entry === "string") {
      const match = /id=(\d+)/.exec(entry);
      if (match?.[1]) ids.push(Number(match[1]));
    }
  }

  return ids;
}

/**
 * Atlassian Document Format flattened to text.
 *
 * The v3 API returns rich text as a tree of nodes rather than a string. The
 * portal has no use for the formatting — the text is **data** (§8.1), and it is
 * delimited before it ever reaches a model — so the tree is walked and the text
 * nodes concatenated.
 *
 * Recursive because the format nests: a paragraph inside a list item inside a
 * table is ordinary, and a version that read only the first level would silently
 * lose most of a description.
 */
function plainText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;

  const pieces: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    if (typeof node !== "object" || node === null) return;

    const record = node as { text?: unknown; content?: unknown; type?: unknown };

    if (typeof record.text === "string") pieces.push(record.text);
    if (record.type === "paragraph" && pieces.length > 0) pieces.push("\n");

    walk(record.content);
  };

  walk(value);

  const text = pieces.join("").trim();
  return text === "" ? null : text;
}

/** An instant in the format JQL accepts: minutes, no seconds, no offset. */
function jql(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
