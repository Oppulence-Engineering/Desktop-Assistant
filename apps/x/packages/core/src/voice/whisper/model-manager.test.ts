import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ModelManager, coremlSidecarDirNameForModelFile } from "./model-manager.js";
import type { ModelEntry } from "./catalog.js";

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** A minimal one-model catalog whose sha256 matches `payload`. */
function makeCatalog(payload: Buffer, overrides: Partial<ModelEntry> = {}): ModelEntry[] {
  return [
    {
      id: "fake-model",
      label: "Fake",
      family: "base",
      english: true,
      quant: "q5_1",
      sizeMb: 1,
      sha256: sha256(payload),
      url: "https://example.test/ggml-fake.bin",
      downloadable: true,
      ...overrides,
    },
  ];
}

/** A fetch that serves `payload`, honoring HTTP Range for resume. */
function makeFetch(payload: Buffer, onCall?: () => void): typeof fetch {
  return (async (_url: string, init?: { headers?: Record<string, string> }) => {
    onCall?.();
    const range = init?.headers?.Range;
    if (range) {
      const from = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      return new Response(payload.subarray(from), { status: 206 });
    }
    return new Response(payload, { status: 200 });
  }) as unknown as typeof fetch;
}

const hugeFree = async () => Number.MAX_SAFE_INTEGER;

describe("ModelManager", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-mm-test-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("downloads, verifies, installs, and lists a model", async () => {
    const payload = Buffer.from("the-model-bytes-0123456789");
    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });

    const dest = await mm.ensure("fake-model");
    expect(await fs.readFile(dest)).toEqual(payload);

    const list = await mm.list();
    expect(list.find((m) => m.id === "fake-model")?.installed).toBe(true);
  });

  it("rejects a checksum mismatch and deletes the downloaded file", async () => {
    const payload = Buffer.from("correct-bytes");
    const catalog = makeCatalog(payload, { sha256: "deadbeef".repeat(8) }); // wrong sha
    const mm = new ModelManager(dir, () => {}, {
      catalog,
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });

    await expect(mm.ensure("fake-model")).rejects.toMatchObject({ code: "checksum_mismatch" });
    // Neither the final file nor the .part should remain.
    const dest = path.join(dir, "ggml-fake.bin");
    await expect(fs.access(dest)).rejects.toBeTruthy();
    await expect(fs.access(`${dest}.part`)).rejects.toBeTruthy();
  });

  it("resumes from a partial .part via HTTP Range", async () => {
    const payload = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    const dest = path.join(dir, "ggml-fake.bin");
    await fs.writeFile(`${dest}.part`, payload.subarray(0, 10)); // pre-existing partial

    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });

    await mm.ensure("fake-model");
    expect(await fs.readFile(dest)).toEqual(payload);
  });

  it("guards against insufficient disk space", async () => {
    const payload = Buffer.from("bytes");
    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload),
      freeBytes: async () => 1, // 1 byte free
    });
    await expect(mm.ensure("fake-model")).rejects.toMatchObject({ code: "insufficient_disk" });
  });

  it("coalesces concurrent ensure() calls into a single download", async () => {
    const payload = Buffer.from("coalesce-me");
    const calls = vi.fn();
    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload, calls),
      freeBytes: hugeFree,
    });

    const [a, b] = await Promise.all([mm.ensure("fake-model"), mm.ensure("fake-model")]);
    expect(a).toBe(b);
    expect(calls).toHaveBeenCalledTimes(1); // one fetch, not two
  });

  it("refuses to download a model with no pinned checksum", async () => {
    const payload = Buffer.from("whatever");
    const catalog = makeCatalog(payload, { sha256: "" });
    const mm = new ModelManager(dir, () => {}, {
      catalog,
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });
    await expect(mm.ensure("fake-model")).rejects.toMatchObject({ code: "download_failed" });
  });

  it("emits download progress then a final 100% tick", async () => {
    const payload = Buffer.alloc(3 * 1024 * 1024, 7); // 3 MB → crosses the 2 MB throttle
    const events: string[] = [];
    const mm = new ModelManager(dir, (p) => events.push(p.phase), {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });
    await mm.ensure("fake-model");
    expect(events).toContain("download");
    expect(events).toContain("verify");
  });

  it("removes an installed model", async () => {
    const payload = Buffer.from("to-be-removed");
    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });
    const dest = await mm.ensure("fake-model");
    await mm.remove("fake-model");
    await expect(fs.access(dest)).rejects.toBeTruthy();
    const list = await mm.list();
    expect(list.find((m) => m.id === "fake-model")?.installed).toBe(false);
  });

  it("marks a Core ML sidecar checksum mismatch repairable", async () => {
    const payload = Buffer.from("model-with-sidecar");
    const sidecarPayload = Buffer.from("sidecar-zip");
    const sidecarSha = sha256(sidecarPayload);
    const catalog = makeCatalog(payload, {
      coreml: {
        url: "https://example.test/ggml-fake-encoder.mlmodelc.zip",
        sha256: sidecarSha,
        sizeMb: 1,
      },
    });
    const dest = path.join(dir, "ggml-fake.bin");
    const sidecar = path.join(dir, coremlSidecarDirNameForModelFile("ggml-fake.bin"));
    await fs.mkdir(sidecar, { recursive: true });
    await fs.writeFile(dest, payload);
    await fs.writeFile(path.join(sidecar, "Manifest.json"), "{}");
    await fs.writeFile(
      path.join(dir, ".catalog-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        installed: {
          "fake-model": {
            path: "ggml-fake.bin",
            bytes: payload.length,
            sha256: sha256(payload),
            installedAt: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
            coreml: true,
            coremlSha256: sha256(Buffer.from("old-sidecar")),
          },
        },
      }),
    );
    const mm = new ModelManager(dir, () => {}, {
      catalog,
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
      platform: "darwin",
    });

    const health = await mm.verifyModel("fake-model");

    expect(health).toMatchObject({
      id: "fake-model",
      installed: true,
      ggufOk: true,
      vadOk: true,
      coremlOk: false,
      repairable: true,
    });
    expect(health.reason).toMatch(/Core ML/);

    await fs.writeFile(
      path.join(sidecar, ".rowboat-coreml.json"),
      JSON.stringify({ sha256: sha256(Buffer.from("wrong-sidecar")), installedAt: new Date() }),
    );
    const badMarkerHealth = await mm.verifyModel("fake-model");
    expect(badMarkerHealth).toMatchObject({
      id: "fake-model",
      installed: true,
      ggufOk: true,
      vadOk: true,
      coremlOk: false,
      repairable: true,
    });
  });

  it("marks a valid Core ML zip without extracted sidecar repairable", async () => {
    const payload = Buffer.from("model-with-valid-zip");
    const sidecarPayload = Buffer.from("valid-sidecar-zip");
    const sidecarSha = sha256(sidecarPayload);
    const catalog = makeCatalog(payload, {
      coreml: {
        url: "https://example.test/ggml-fake-encoder.mlmodelc.zip",
        sha256: sidecarSha,
        sizeMb: 1,
      },
    });
    await fs.writeFile(path.join(dir, "ggml-fake.bin"), payload);
    await fs.writeFile(path.join(dir, "ggml-fake-encoder.mlmodelc.zip"), sidecarPayload);
    await fs.writeFile(
      path.join(dir, ".catalog-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        installed: {
          "fake-model": {
            path: "ggml-fake.bin",
            bytes: payload.length,
            sha256: sha256(payload),
            installedAt: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
            coreml: true,
            coremlSha256: sidecarSha,
          },
        },
      }),
    );
    const mm = new ModelManager(dir, () => {}, {
      catalog,
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
      platform: "darwin",
    });

    const health = await mm.verifyModel("fake-model");

    expect(health).toMatchObject({
      id: "fake-model",
      installed: true,
      ggufOk: true,
      vadOk: true,
      coremlOk: false,
      repairable: true,
    });
    expect(health.reason).toMatch(/sidecar.*missing|extract/i);
  });

  it("does not trust a Core ML sidecar directory without a matching install marker", async () => {
    const payload = Buffer.from("model-with-untrusted-sidecar");
    const sidecarPayload = Buffer.from("trusted-sidecar-zip");
    const sidecarSha = sha256(sidecarPayload);
    const catalog = makeCatalog(payload, {
      coreml: {
        url: "https://example.test/ggml-fake-encoder.mlmodelc.zip",
        sha256: sidecarSha,
        sizeMb: 1,
      },
    });
    const sidecar = path.join(dir, coremlSidecarDirNameForModelFile("ggml-fake.bin"));
    await fs.mkdir(sidecar, { recursive: true });
    await fs.writeFile(path.join(dir, "ggml-fake.bin"), payload);
    await fs.writeFile(path.join(sidecar, "Manifest.json"), "{}");
    await fs.writeFile(
      path.join(dir, ".catalog-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        installed: {
          "fake-model": {
            path: "ggml-fake.bin",
            bytes: payload.length,
            sha256: sha256(payload),
            installedAt: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
            coreml: true,
            coremlSha256: sidecarSha,
          },
        },
      }),
    );
    const mm = new ModelManager(dir, () => {}, {
      catalog,
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
      platform: "darwin",
    });

    const health = await mm.verifyModel("fake-model");

    expect(health).toMatchObject({
      id: "fake-model",
      installed: true,
      ggufOk: true,
      vadOk: true,
      coremlOk: false,
      repairable: true,
    });
    expect(health.reason).toMatch(/Core ML/);
  });

  it("does not report a stale ledger entry as installed when the model file is missing", async () => {
    const payload = Buffer.from("missing-model");
    await fs.writeFile(
      path.join(dir, ".catalog-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        installed: {
          "fake-model": {
            path: "ggml-fake.bin",
            bytes: payload.length,
            sha256: sha256(payload),
            installedAt: new Date().toISOString(),
            lastVerifiedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload),
      freeBytes: hugeFree,
    });

    const list = await mm.list();
    expect(list.find((m) => m.id === "fake-model")?.installed).toBe(false);

    const health = await mm.verifyModel("fake-model");

    expect(health).toMatchObject({
      id: "fake-model",
      installed: false,
      ggufOk: false,
      vadOk: true,
      repairable: true,
    });
    expect(health.reason).toMatch(/missing/i);
  });

  it("repairs a corrupted model by removing and ensuring it again", async () => {
    const payload = Buffer.from("healthy-model-bytes");
    const fetchCalls = vi.fn();
    const mm = new ModelManager(dir, () => {}, {
      catalog: makeCatalog(payload),
      fetchImpl: makeFetch(payload, fetchCalls),
      freeBytes: hugeFree,
    });

    const dest = await mm.ensure("fake-model");
    await fs.writeFile(dest, Buffer.from("corrupt-model-bytes"));

    const corrupted = await mm.verifyModel("fake-model");
    expect(corrupted).toMatchObject({
      id: "fake-model",
      installed: false,
      ggufOk: false,
      vadOk: true,
      repairable: true,
    });

    const repaired = await mm.repairModel("fake-model");

    expect(repaired).toMatchObject({
      id: "fake-model",
      installed: true,
      ggufOk: true,
      vadOk: true,
      repairable: false,
    });
    expect(await fs.readFile(dest)).toEqual(payload);
    expect(fetchCalls).toHaveBeenCalledTimes(2);
  });

  it("matches whisper.cpp Core ML sidecar names for quantized models", () => {
    expect(coremlSidecarDirNameForModelFile("ggml-tiny.en-q5_1.bin")).toBe(
      "ggml-tiny.en-encoder.mlmodelc",
    );
    expect(coremlSidecarDirNameForModelFile("ggml-base-q5_1.bin")).toBe(
      "ggml-base-encoder.mlmodelc",
    );
    expect(coremlSidecarDirNameForModelFile("ggml-large-v3-turbo-q5_0.bin")).toBe(
      "ggml-large-v3-turbo-encoder.mlmodelc",
    );
  });
});
