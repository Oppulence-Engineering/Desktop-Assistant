import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// memory/config.ts is the only importer of ../config/config.js in this graph.
const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-mem-ollama-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import {
  LOCAL_EMBED_MODEL,
  LOCAL_EMBED_MODEL_ID,
  isLocalEmbedModel,
  listOllamaModels,
  localEmbedModelReady,
  ollamaHost,
  ollamaModelName,
  resetOllamaProbe,
} from "./ollama.js";

/** Stands in for the daemon: `tags` is what /api/tags reports, or null for "not running". */
function stubOllama(tags: string[] | null): { pulls: string[]; calls: string[] } {
  const pulls: string[] = [];
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (tags === null) throw new Error("ECONNREFUSED");
    if (String(url).endsWith("/api/pull")) {
      pulls.push(JSON.parse(String(init?.body ?? "{}")).model);
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }
    return new Response(JSON.stringify({ models: tags.map((name) => ({ name })) }), {
      status: 200,
    });
  });
  return { pulls, calls };
}

beforeEach(() => {
  resetOllamaProbe();
  delete process.env.OLLAMA_HOST;
  delete process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetOllamaProbe();
  delete process.env.OLLAMA_HOST;
  delete process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS;
});

describe("model identity", () => {
  // The manifest's model string is what forces a rebuild when the embedding
  // model changes and what routing keys on when embedding a query against
  // stored vectors. A bare name would collide with the hosted OpenAI ids in
  // that same field, leaving no way to tell which provider made the vectors.
  it("namespaces the local model so it cannot be confused with a hosted one", () => {
    expect(LOCAL_EMBED_MODEL_ID).toBe(`ollama/${LOCAL_EMBED_MODEL}`);
    expect(isLocalEmbedModel(LOCAL_EMBED_MODEL_ID)).toBe(true);
    expect(isLocalEmbedModel("text-embedding-3-small")).toBe(false);
    expect(ollamaModelName(LOCAL_EMBED_MODEL_ID)).toBe(LOCAL_EMBED_MODEL);
  });
});

describe("ollamaHost", () => {
  // OLLAMA_HOST is Ollama's own convention and is routinely set without a
  // scheme, which is not a URL fetch will accept.
  it("accepts OLLAMA_HOST with or without a scheme", () => {
    process.env.OLLAMA_HOST = "127.0.0.1:11434";
    expect(ollamaHost()).toBe("http://127.0.0.1:11434");
    process.env.OLLAMA_HOST = "http://box.local:11434/";
    expect(ollamaHost()).toBe("http://box.local:11434");
  });

  it("defaults to the local daemon", () => {
    expect(ollamaHost()).toBe("http://127.0.0.1:11434");
  });
});

describe("listOllamaModels", () => {
  it("strips the implicit :latest tag", async () => {
    stubOllama(["nomic-embed-text:latest", "llama3.2:3b"]);
    expect(await listOllamaModels()).toEqual(["nomic-embed-text", "llama3.2:3b"]);
  });

  // No daemon is the common case, not a fault: most machines have no Ollama
  // and the memory index has to carry on against the hosted provider.
  it("reports null rather than throwing when nothing is listening", async () => {
    stubOllama(null);
    expect(await listOllamaModels()).toBeNull();
  });
});

describe("localEmbedModelReady", () => {
  it("is ready when the daemon has the model", async () => {
    stubOllama(["nomic-embed-text"]);
    expect(await localEmbedModelReady()).toBe(true);
  });

  it("is not ready when no daemon is listening", async () => {
    stubOllama(null);
    expect(await localEmbedModelReady()).toBe(false);
  });

  // A 274MB download cannot hold up an index pass, so the pull is kicked off
  // and this pass stays on the hosted provider.
  it("starts a pull when the daemon is up but the model is missing, without blocking", async () => {
    const { pulls } = stubOllama(["llama3.2:3b"]);
    expect(await localEmbedModelReady()).toBe(false);
    await vi.waitFor(() => expect(pulls).toEqual([LOCAL_EMBED_MODEL]));
  });

  // Probing on every embed call would put a round trip in the hot path.
  it("caches the answer instead of probing per call", async () => {
    const { calls } = stubOllama(["nomic-embed-text"]);
    await localEmbedModelReady();
    await localEmbedModelReady();
    await localEmbedModelReady();
    expect(calls.filter((c) => c.endsWith("/api/tags"))).toHaveLength(1);
  });

  it("never touches the daemon when local embeddings are off", async () => {
    process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS = "off";
    const { calls } = stubOllama(["nomic-embed-text"]);
    expect(await localEmbedModelReady()).toBe(false);
    expect(calls).toEqual([]);
  });
});
