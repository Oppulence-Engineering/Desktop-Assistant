import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Packaged whisper-cli E2E (RFC 009 WP 3.x). Proves the per-arch whisper-cli is
 * staged into the packaged app and that the engine path is reachable — the gap
 * that left every release shipping without on-device transcription.
 *
 * Runs in two modes so the *same* spec is safe on the PR gate (which packages
 * without the binary) and meaningful on the nightly (which stages it):
 *   - default (no flags): assert only that the capability IPC returns a
 *     well-formed result and never throws. The binary may be absent.
 *   - WHISPER_E2E_EXPECT_BINARY=1: also assert the whisper-cli file is present in
 *     the packaged Resources/ (proves staging). Set on all staged legs.
 *   - WHISPER_E2E_EXPECT_ENGINE=1 (implies EXPECT_BINARY): also assert the probe
 *     actually spawned the binary (reason !== "whisper-cli unavailable"). Set on
 *     legs where the binary's runtime deps resolve (macOS Metal, Linux+libvulkan1).
 *   - WHISPER_E2E_RUN_TRANSCRIBE=1 (implies EXPECT_ENGINE): also download the
 *     smallest model and transcribe the committed fixture clip, asserting text.
 *     Opt-in (needs a Hugging Face download); used for local/deep validation.
 */

const EXPECT_ENGINE = process.env.WHISPER_E2E_EXPECT_ENGINE === "1";
const EXPECT_BINARY = EXPECT_ENGINE || process.env.WHISPER_E2E_EXPECT_BINARY === "1";
const RUN_TRANSCRIBE = process.env.WHISPER_E2E_RUN_TRANSCRIBE === "1";

const FIXTURE_WAV = path.resolve(
  here,
  "../../../packages/core/src/voice/whisper/__fixtures__/asr/quick-brown-fox.wav",
);

/** Resolve the packaged Electron binary (mirrors smoke.spec.ts). */
function resolveBinary(): string {
  const override = process.env.ELECTRON_APP_BINARY;
  if (override && existsSync(override)) return override;

  const outDir = path.resolve(here, "..", "out");
  const candidates = [
    "Solomon AI-linux-x64/solomon-ai",
    "Solomon AI-linux-arm64/solomon-ai",
    "Solomon AI-win32-x64/solomon-ai.exe",
    "Solomon AI-win32-arm64/solomon-ai.exe",
    "Solomon AI-darwin-x64/Solomon AI.app/Contents/MacOS/solomon-ai",
    "Solomon AI-darwin-arm64/Solomon AI.app/Contents/MacOS/solomon-ai",
  ].map((rel) => path.join(outDir, rel));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Packaged binary not found. Run \`npm run package\` first, or set ELECTRON_APP_BINARY. Looked under ${outDir}`,
    );
  }
  return found;
}

/** Locate the bundled whisper-cli relative to the packaged app executable. */
function packagedWhisperPath(appBinary: string): string {
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  if (process.platform === "darwin") {
    // .../Solomon AI.app/Contents/MacOS/solomon-ai → .../Contents/Resources/whisper/<exe>
    const contents = path.resolve(path.dirname(appBinary), "..");
    return path.join(contents, "Resources", "whisper", exe);
  }
  // linux/win: <dir>/solomon-ai[.exe] → <dir>/resources/whisper/<exe>
  return path.join(path.dirname(appBinary), "resources", "whisper", exe);
}

/** Read the committed 16 kHz mono 16-bit WAV and return its PCM payload as base64. */
function fixturePcmBase64(): string {
  const buf = readFileSync(FIXTURE_WAV);
  // Locate the `data` subchunk rather than assuming the 44-byte offset.
  const dataIdx = buf.indexOf("data", 12, "ascii");
  if (dataIdx < 0) throw new Error(`no data chunk in ${FIXTURE_WAV}`);
  const pcm = buf.subarray(dataIdx + 8); // skip "data" + 4-byte size
  return pcm.toString("base64");
}

interface Capability {
  supported: boolean;
  accel: string;
  cores: number;
  reason?: string;
}

let app: ElectronApplication;

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

test("packaged whisper engine is staged and reachable", async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "rowboat-whisper-e2e-"));
  const appBinary = resolveBinary();

  if (EXPECT_BINARY) {
    // The staging fix's core invariant: the binary actually shipped in the package.
    expect(
      existsSync(packagedWhisperPath(appBinary)),
      `whisper-cli not found in package at ${packagedWhisperPath(appBinary)} — staging failed`,
    ).toBe(true);
  }

  app = await electron.launch({
    executablePath: appBinary,
    args: ["--no-sandbox"],
    env: { ...process.env, ROWBOAT_WORKDIR: workdir, NODE_ENV: "production" },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // Wait for the preload contextBridge to expose window.ipc.
  await expect
    .poll(
      () =>
        window.evaluate(
          () => typeof (window as unknown as { ipc?: { invoke?: unknown } }).ipc?.invoke,
        ),
      {
        timeout: 45_000,
        message: "preload never exposed window.ipc",
      },
    )
    .toBe("function");

  // The capability IPC always resolves to a well-formed result (never throws),
  // even when the binary is absent.
  const cap = (await window.evaluate(() =>
    (window as unknown as { ipc: { invoke(c: string, a: unknown): Promise<unknown> } }).ipc.invoke(
      "whisper:capability",
      null,
    ),
  )) as Capability;

  expect(cap).toMatchObject({
    supported: expect.any(Boolean),
    accel: expect.any(String),
    cores: expect.any(Number),
  });
  expect(["coreml", "metal", "cuda", "vulkan", "cpu"]).toContain(cap.accel);

  if (EXPECT_ENGINE) {
    // The probe spawns whisper-cli; "whisper-cli unavailable" means it could not
    // be found/started. Anything else means the binary ran (CPU fallback is fine).
    expect(
      cap.reason,
      `whisper-cli did not start (accel=${cap.accel}, supported=${cap.supported})`,
    ).not.toBe("whisper-cli unavailable");
  }

  if (!RUN_TRANSCRIBE) return;

  // Deep, opt-in check: download the smallest model and transcribe the fixture.
  const ensured = (await window.evaluate(() =>
    (window as unknown as { ipc: { invoke(c: string, a: unknown): Promise<unknown> } }).ipc.invoke(
      "whisper:ensureModel",
      { id: "tiny.en-q5_1" },
    ),
  )) as { success: boolean; code?: string };
  expect(ensured.success, `ensureModel failed: ${ensured.code ?? "unknown"}`).toBe(true);

  const res = (await window.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return (
      window as unknown as { ipc: { invoke(c: string, a: unknown): Promise<unknown> } }
    ).ipc.invoke("whisper:transcribe", {
      pcm16: u8.buffer,
      sampleRate: 16000,
      channels: 1,
      model: "tiny.en-q5_1",
      lang: "en",
    });
  }, fixturePcmBase64())) as { success: boolean; text?: string; code?: string };

  expect(res.success, `transcribe failed: ${res.code ?? "unknown"}`).toBe(true);
  // Reference: "the quick brown fox jumps over the lazy dog". tiny.en is imprecise,
  // so assert a robust anchor word rather than an exact match.
  expect((res.text ?? "").toLowerCase()).toContain("fox");
});
