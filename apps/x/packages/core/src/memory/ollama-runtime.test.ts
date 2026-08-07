import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// vi.hoisted runs before imports, so this has to be a literal.
const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-ollama-runtime-test");
vi.mock("../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import {
  canProvisionRuntime,
  daemonResponds,
  ensureOllamaRuntime,
  installRuntime,
  stopOllamaRuntime,
} from "./ollama-runtime.js";

/** Answers /api/version at the given hosts and 404s everywhere else. */
function stubDaemons(liveHosts: string[]): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const u = String(url);
    seen.push(u);
    if (liveHosts.some((h) => u.startsWith(h))) {
      return new Response(JSON.stringify({ version: "0.32.6" }), { status: 200 });
    }
    throw new Error("ECONNREFUSED");
  });
  return seen;
}

beforeEach(async () => {
  stopOllamaRuntime();
  delete process.env.OLLAMA_HOST;
  delete process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS;
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true });
  await fs.mkdir(path.join(TEST_WORKDIR, "config"), { recursive: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  stopOllamaRuntime();
  delete process.env.OLLAMA_HOST;
  delete process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS;
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true }).catch(() => {});
});

describe("ensureOllamaRuntime", () => {
  // Starting a second copy of a daemon the user already runs would duplicate a
  // multi-gigabyte model store and fight over GPU memory, for no gain.
  it("uses the user's own daemon rather than managing one", async () => {
    stubDaemons(["http://127.0.0.1:11434"]);
    expect(await ensureOllamaRuntime()).toBe("http://127.0.0.1:11434");
  });

  // An explicit OLLAMA_HOST is a deployment decision — a remote box, a
  // container, a non-standard port. Probing 127.0.0.1 anyway would silently
  // ignore it.
  it("honours an explicit OLLAMA_HOST and does not fall back past it", async () => {
    process.env.OLLAMA_HOST = "box.local:11434";
    const seen = stubDaemons(["http://box.local:11434"]);
    expect(await ensureOllamaRuntime()).toBe("http://box.local:11434");
    expect(seen.every((u) => u.startsWith("http://box.local"))).toBe(true);
  });

  it("reports nothing usable when a configured OLLAMA_HOST is down", async () => {
    process.env.OLLAMA_HOST = "box.local:11434";
    stubDaemons([]);
    expect(await ensureOllamaRuntime()).toBeNull();
  });

  it("never touches the network when local embeddings are off", async () => {
    process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS = "off";
    const seen = stubDaemons(["http://127.0.0.1:11434"]);
    expect(await ensureOllamaRuntime()).toBeNull();
    expect(seen).toEqual([]);
  });

  // `system` is for people who want local embeddings but not a 146MB download
  // they did not ask for.
  it("does not provision in system mode when no daemon is running", async () => {
    process.env.SOLOMON_MEMORY_LOCAL_EMBEDDINGS = "system";
    const seen = stubDaemons([]);
    expect(await ensureOllamaRuntime()).toBeNull();
    expect(seen.some((u) => u.includes("github.com"))).toBe(false);
  });
});

describe("installRuntime", () => {
  // The integrity invariant, inherited from the whisper model manager: bytes
  // only reach the install path after matching the pinned checksum. This one
  // matters more than whisper's — the artifact is a binary we then spawn.
  it("refuses to install an archive whose checksum does not match", async () => {
    vi.stubGlobal("fetch", async () => new Response("not the real runtime", { status: 200 }));
    expect(await installRuntime()).toBe(false);

    const runtimeRoot = path.join(TEST_WORKDIR, "runtime", "ollama");
    const entries = await fs.readdir(runtimeRoot).catch(() => [] as string[]);
    // No version directory, and no staging tree left behind.
    expect(entries.filter((e) => !e.includes(".tmp-"))).toEqual([]);
  });

  it("reports failure rather than throwing when the download errors", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await installRuntime()).toBe(false);
  });

  it("coalesces concurrent installs into one download", async () => {
    let downloads = 0;
    vi.stubGlobal("fetch", async () => {
      downloads += 1;
      await new Promise((r) => setTimeout(r, 10));
      return new Response("bad bytes", { status: 200 });
    });
    await Promise.all([installRuntime(), installRuntime(), installRuntime()]);
    expect(downloads).toBe(1);
  });
});

describe("canProvisionRuntime", () => {
  // Ollama's darwin archive is 145MB; the linux and windows builds are 1.4GB
  // because they carry CUDA and ROCm runners this app will never load for a
  // 137M-parameter embedding model. Downloading that silently is not a trade
  // worth making, so those platforms use a daemon the user already runs.
  it("provisions on macOS only", () => {
    expect(canProvisionRuntime("darwin")).toBe(true);
    expect(canProvisionRuntime("linux")).toBe(false);
    expect(canProvisionRuntime("win32")).toBe(false);
  });
});

describe("daemonResponds", () => {
  it("is false rather than throwing when nothing is listening", async () => {
    stubDaemons([]);
    expect(await daemonResponds("http://127.0.0.1:11434")).toBe(false);
  });

  it("is false on a non-2xx answer from something that is not Ollama", async () => {
    vi.stubGlobal("fetch", async () => new Response("nginx", { status: 404 }));
    expect(await daemonResponds("http://127.0.0.1:11434")).toBe(false);
  });
});
