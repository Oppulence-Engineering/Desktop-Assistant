import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Packaged `oppulence-audiocap` E2E. Proves the capture helper is staged into the
 * packaged app and that the capture IPC is reachable — the same staging gap that left
 * releases shipping without on-device transcription applies here, and a missing helper
 * degrades silently to in-app capture, which is exactly the sort of regression nobody
 * notices until a meeting is one-sided.
 *
 * Two modes, so the same spec is safe on the PR gate (packages without the binary)
 * and meaningful on the nightly (stages it):
 *   - default: assert the IPC resolves to a well-formed result and never throws.
 *   - AUDIOCAP_E2E_EXPECT_BINARY=1: also assert the helper is present in the
 *     packaged Resources/ and that the engine resolves to `native`.
 *
 * Deliberately does not record: capture needs microphone and system-audio TCC grants
 * that a CI runner cannot give, and a "recording" assertion there would only ever
 * prove the failure path. Levels and signal are verified by hand per the runbook in
 * apps/x/MEETING_CAPTURE.md.
 */

const EXPECT_BINARY = process.env.AUDIOCAP_E2E_EXPECT_BINARY === "1";

/** Resolve the packaged Electron binary (mirrors whisper.spec.ts). */
function resolveBinary(): string {
  const override = process.env.ELECTRON_APP_BINARY;
  if (override && existsSync(override)) return override;

  const outDir = path.resolve(here, "..", "out");
  const candidates = [
    "Oppulence-darwin-arm64/Oppulence.app/Contents/MacOS/oppulence",
    "Oppulence-darwin-x64/Oppulence.app/Contents/MacOS/oppulence",
    "Oppulence-linux-x64/oppulence",
    "Oppulence-linux-arm64/oppulence",
    "Oppulence-win32-x64/oppulence.exe",
  ].map((rel) => path.join(outDir, rel));

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Packaged binary not found. Run \`npm run package\` first, or set ELECTRON_APP_BINARY. Looked under ${outDir}`,
    );
  }
  return found;
}

function packagedAudiocapPath(appBinary: string): string {
  const exe = "oppulence-audiocap";
  if (process.platform === "darwin") {
    const contents = path.resolve(path.dirname(appBinary), "..");
    return path.join(contents, "Resources", "audiocap", exe);
  }
  return path.join(path.dirname(appBinary), "resources", "audiocap", exe);
}

interface DoctorReport {
  ok: boolean;
  nativeAvailable: boolean;
  sidecarVersion?: string;
  checks: { name: string; status: string; detail: string }[];
}

let app: ElectronApplication;

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

test.skip(process.platform !== "darwin", "native capture is macOS-only");

test("packaged audiocap helper is staged and its IPC is reachable", async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "rowboat-audiocap-e2e-"));
  const appBinary = resolveBinary();

  if (EXPECT_BINARY) {
    expect(
      existsSync(packagedAudiocapPath(appBinary)),
      `oppulence-audiocap not found in package at ${packagedAudiocapPath(appBinary)} — staging failed`,
    ).toBe(true);
  }

  app = await electron.launch({
    executablePath: appBinary,
    args: ["--no-sandbox"],
    env: { ...process.env, ROWBOAT_WORKDIR: workdir, NODE_ENV: "production" },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await expect
    .poll(
      () =>
        window.evaluate(
          () => typeof (window as unknown as { ipc?: { invoke?: unknown } }).ipc?.invoke,
        ),
      { timeout: 45_000, message: "preload never exposed window.ipc" },
    )
    .toBe("function");

  const invoke = <T>(channel: string, args: unknown = null) =>
    window.evaluate(
      ([c, a]) =>
        (
          window as unknown as { ipc: { invoke(c: string, a: unknown): Promise<unknown> } }
        ).ipc.invoke(c as string, a),
      [channel, args] as [string, unknown],
    ) as Promise<T>;

  // Always well-formed, binary or not — the renderer decides which pipeline to run
  // off this value, so it must never throw.
  const { engine } = await invoke<{ engine: string }>("meeting:captureEngine");
  expect(["native", "renderer"]).toContain(engine);

  // No probe: it would request system-audio access, which a CI run cannot grant and a
  // user has not asked for.
  const doctor = await invoke<DoctorReport>("meeting:captureDoctor", {
    probeSystemAudio: false,
  });
  expect(doctor).toMatchObject({
    ok: expect.any(Boolean),
    nativeAvailable: expect.any(Boolean),
  });
  // Every check the UI renders needs these fields to be actionable.
  for (const check of doctor.checks) {
    expect(["ok", "warn", "fail"]).toContain(check.status);
    expect(check.detail.length).toBeGreaterThan(0);
  }

  const status = await invoke<{ state: string; queueDepth: number }>("meeting:captureStatus");
  expect(status.state).toBe("idle");
  expect(status.queueDepth).toBe(0);

  // A fresh workdir has no recordings; the list must be empty, not an error.
  const { sessions } = await invoke<{ sessions: unknown[] }>("meeting:listSessions");
  expect(sessions).toEqual([]);

  if (EXPECT_BINARY) {
    expect(engine).toBe("native");
    expect(doctor.nativeAvailable).toBe(true);
    expect(doctor.sidecarVersion).toMatch(/^\d+\.\d+\.\d+$/);
  }
});
