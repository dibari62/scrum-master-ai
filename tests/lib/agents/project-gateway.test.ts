import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Il gateway di un progetto, e l'indirizzo che nessuno leggeva.
 *
 * **Il difetto che questo file blocca.** `brainBaseUrl` si poteva compilare,
 * validare e salvare — c'è un campo nel modulo, un vincolo nel database e uno
 * schema Zod — e `gatewayForProject` non lo passava all'adattatore. Le
 * richieste andavano comunque all'indirizzo pubblico del fornitore.
 *
 * Riguarda i due casi per cui quel campo esiste: un Ollama che gira su
 * un'altra macchina, e un gateway aziendale che espone la stessa API dietro un
 * indirizzo interno. Per entrambi il portale prometteva una cosa e ne faceva
 * un'altra, in silenzio.
 *
 * Nessuna rete: `fetch` è sostituito, e ciò che si verifica è **a quale
 * indirizzo** sarebbe andata la richiesta.
 */

const ORGANIZATION_ID = "3f1a9c2e-8b6d-4f2a-9c1e-5d7b3a8f0e21";
const PROJECT_ID = "9d5b2c31-6a7e-4c0f-b2d8-11a4e6f3c905";

vi.mock("@/db/project-settings", () => ({
  readProjectSettings: async () => ({
    brainProvider: "ollama" as const,
    brainModel: "llama3.1",
    brainBaseUrl: "https://modelli.interno.esempio/v1",
  }),
  revealProjectSecret: async () => null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("il gateway di un progetto", () => {
  it("chiama l'indirizzo configurato, non quello pubblico del fornitore", async () => {
    const calls: string[] = [];

    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls.push(String(input));

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "pronto" } }],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
          model: "llama3.1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const { gatewayForProject } = await import("@/lib/agents/project-gateway");

    const gateway = await gatewayForProject(ORGANIZATION_ID as never, PROJECT_ID as never);

    await gateway.complete({
      system: "prova",
      prompt: "prova",
      maxTokens: 32,
      language: "it",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("https://modelli.interno.esempio/v1/chat/completions");

    // La prova che discrimina: con il difetto la richiesta finiva qui.
    expect(calls[0]).not.toContain("localhost:11434");
  });
});
