import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-onnx-assets-test");
vi.mock("../../config/config.js", () => ({ WorkDir: TEST_WORKDIR }));

import {
  MINILM,
  assetsInstalled,
  configureBundledEmbeddings,
  installAssets,
  modelDir,
  resolveAssetDir,
  type EmbedModelSpec,
} from "./assets.js";

/** sha256 of "good bytes", so one file can be made to verify and another not. */
const GOOD = "good bytes";
const GOOD_SHA = "b6f5b4d9d2e3ba9d5f6c1d1a6e1e5f2c0b7f5b0a8c5e3d1f9a7b5c3d1e9f7a5b";

function spec(sha: string): EmbedModelSpec {
  return {
    id: "local/test-model",
    dims: 8,
    maxTokens: 16,
    files: [{ name: "model.onnx", url: "https://example.test/model.onnx", sha256: sha, bytes: 10 }],
  };
}

beforeEach(async () => {
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await fs.rm(TEST_WORKDIR, { recursive: true, force: true }).catch(() => {});
});

describe("installAssets", () => {
  // The integrity rule, same as the whisper model manager. Weights are not
  // executable, but a substituted model produces vectors that rank the user's
  // own notes wrongly — a failure with no symptom at all.
  it("refuses bytes that do not match the pinned checksum", async () => {
    vi.stubGlobal("fetch", async () => new Response("wrong bytes", { status: 200 }));

    expect(await installAssets(spec(GOOD_SHA))).toBe(false);

    const entries = await fs.readdir(modelDir(spec(GOOD_SHA))).catch(() => [] as string[]);
    expect(entries).toEqual([]);
  });

  // An unpinned checksum has to fail closed. If a missing pin meant "skip the
  // check", adding a model and forgetting to hash it would silently disable
  // verification for that model rather than break loudly.
  it("refuses a file with no pinned checksum at all", async () => {
    vi.stubGlobal("fetch", async () => new Response(GOOD, { status: 200 }));

    expect(await installAssets(spec(""))).toBe(false);
  });

  it("leaves no partial file behind when verification fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("wrong bytes", { status: 200 }));
    await installAssets(spec(GOOD_SHA));

    const entries = await fs.readdir(modelDir(spec(GOOD_SHA))).catch(() => [] as string[]);
    // Not even a .part- file: the next run must not mistake it for progress.
    expect(entries.filter((e) => e.includes(".part-"))).toEqual([]);
  });

  it("reports failure rather than throwing when the download errors", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    expect(await installAssets(spec(GOOD_SHA))).toBe(false);
  });

  it("coalesces concurrent installs into one download", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return new Response("wrong bytes", { status: 200 });
    });
    const s = spec(GOOD_SHA);
    await Promise.all([installAssets(s), installAssets(s), installAssets(s)]);
    expect(calls).toBe(1);
  });
});

describe("assetsInstalled", () => {
  it("is false when a file is missing", async () => {
    expect(await assetsInstalled(spec(GOOD_SHA))).toBe(false);
  });

  it("is true once every file is present", async () => {
    const s = spec(GOOD_SHA);
    const dir = modelDir(s);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "model.onnx"), GOOD);
    expect(await assetsInstalled(s)).toBe(true);
  });
});

/**
 * The model ships inside the app bundle, so semantic memory works on first
 * launch with no download and no dependency on Hugging Face being reachable.
 * A plain dev checkout has an empty vendor/embeddings, so the runtime download
 * still has to cover that case — these pin both halves.
 */
describe("bundled model", () => {
  const BUNDLED = path.join(TEST_WORKDIR, "bundled");

  beforeEach(async () => {
    configureBundledEmbeddings("");
    await fs.mkdir(BUNDLED, { recursive: true });
  });

  afterEach(() => configureBundledEmbeddings(""));

  async function plantBundled(): Promise<void> {
    for (const file of MINILM.files) {
      await fs.writeFile(path.join(BUNDLED, file.name), "bundled bytes");
    }
    configureBundledEmbeddings(BUNDLED);
  }

  it("resolves to the bundled copy when the app shipped with one", async () => {
    await plantBundled();
    expect(await resolveAssetDir(MINILM)).toBe(BUNDLED);
    expect(await assetsInstalled(MINILM)).toBe(true);
  });

  // The whole point: no first-launch download, and no first-launch Ollama
  // provisioning either, since resolveEmbedModel short-circuits on installed.
  it("downloads nothing when the model is bundled", async () => {
    await plantBundled();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await installAssets(MINILM)).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the downloaded copy when nothing is bundled", async () => {
    const dir = modelDir(MINILM);
    await fs.mkdir(dir, { recursive: true });
    for (const file of MINILM.files) {
      await fs.writeFile(path.join(dir, file.name), "downloaded bytes");
    }
    expect(await resolveAssetDir(MINILM)).toBe(dir);
  });

  it("reports nothing available when neither exists", async () => {
    expect(await resolveAssetDir(MINILM)).toBeNull();
    expect(await assetsInstalled(MINILM)).toBe(false);
  });

  it("ignores a bundled directory that is missing a file", async () => {
    await fs.writeFile(path.join(BUNDLED, "vocab.txt"), "only half");
    configureBundledEmbeddings(BUNDLED);
    expect(await resolveAssetDir(MINILM)).toBeNull();
  });
});

/**
 * The fetch script carries its own copy of the URLs and checksums so it can run
 * standalone, before anything is built. Two lists that must agree is exactly how
 * a build ends up shipping a model the app will not accept, so pin them.
 */
describe("fetch script stays in sync with the pinned catalog", () => {
  it("declares the same files and checksums as MINILM", async () => {
    const script = await fs.readFile(
      new URL("../../../../../scripts/embeddings-fetch.mjs", import.meta.url),
      "utf8",
    );
    for (const file of MINILM.files) {
      expect(script, `${file.name} missing from the fetch script`).toContain(file.name);
      expect(script, `${file.name} checksum drifted`).toContain(file.sha256);
      expect(script, `${file.name} url drifted`).toContain(file.url.replace(/^.*\/main/, ""));
    }
  });
});
