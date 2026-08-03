import { expect, test, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DictationSettings } from "@x/shared/dist/transcription.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPECT_FAST_ENGINE = process.env.DICTATION_E2E_EXPECT_FAST === "1";
const FIXTURE_WAV = path.resolve(
  here,
  "../../../packages/core/src/voice/whisper/__fixtures__/asr/quick-brown-fox.wav",
);

function fixturePcmBase64(): string {
  const wav = readFileSync(FIXTURE_WAV);
  const dataIdx = wav.indexOf("data", 12, "ascii");
  if (dataIdx < 0) throw new Error(`no data chunk in ${FIXTURE_WAV}`);
  return wav.subarray(dataIdx + 8).toString("base64");
}

function resolveBinary(): string {
  const override = process.env.ELECTRON_APP_BINARY;
  if (override && existsSync(override)) return override;

  const candidate = path.resolve(
    here,
    "../out/Oppulence-darwin-arm64/Oppulence.app/Contents/MacOS/oppulence",
  );
  if (!existsSync(candidate)) {
    throw new Error(`Packaged binary not found at ${candidate}. Run npm run package first.`);
  }
  return candidate;
}

type DictationStatus = {
  available: boolean;
  monitorReady: boolean;
  commandModeReady: boolean;
  commandModeEnabled: boolean;
  transformsEnabled: boolean;
  transformShortcutsReady: boolean;
  accessibilityTrusted: boolean;
  shortcut: string;
  commandShortcut: string;
  transformShortcutError?: string;
  error?: string;
};

let app: ElectronApplication;

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

test("packaged desktop dictation helper and overlay are live", async () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "oppulence-dictation-e2e-"));
  app = await electron.launch({
    executablePath: resolveBinary(),
    args: ["--no-sandbox"],
    env: { ...process.env, ROWBOAT_WORKDIR: workdir, NODE_ENV: "production" },
  });

  const mainWindow = await app.firstWindow();
  await mainWindow.waitForLoadState("domcontentloaded");
  await expect
    .poll(() => mainWindow.evaluate(() => typeof window.ipc?.invoke), { timeout: 45_000 })
    .toBe("function");

  await expect
    .poll(
      () =>
        mainWindow.evaluate(
          () => window.ipc.invoke("dictation:getStatus", null) as Promise<DictationStatus>,
        ),
      { timeout: 15_000 },
    )
    .toMatchObject({
      available: true,
      monitorReady: true,
      commandModeReady: true,
      commandModeEnabled: true,
      transformsEnabled: false,
      transformShortcutsReady: false,
      shortcut: "Hold Control + Option",
      commandShortcut: "Command + Control + Option",
    });

  expect(
    await mainWindow.evaluate(() =>
      window.ipc.invoke("dictation:getHistory", {
        limit: 20,
        offset: 0,
      }),
    ),
  ).toMatchObject({
    entries: [],
    total: 0,
    retention: "forever",
    stats: {
      totalWords: 0,
      averageWpm: 0,
      streakDays: 0,
      totalDictations: 0,
    },
  });

  expect(
    await app.evaluate(({ globalShortcut }) => ({
      pasteLast: globalShortcut.isRegistered("Command+Control+V"),
      copyLast: globalShortcut.isRegistered("Command+Control+C"),
      retryFailed: globalShortcut.isRegistered("Command+Control+R"),
    })),
  ).toEqual({ pasteLast: true, copyLast: true, retryFailed: true });

  await expect
    .poll(
      async () => {
        const windows = app.windows();
        return windows.find((candidate) => candidate.url().endsWith("/dictation.html")) ?? null;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();

  const dictationWindow = app
    .windows()
    .find((candidate) => candidate.url().endsWith("/dictation.html"));
  expect(dictationWindow, "dictation overlay renderer was not created").toBeTruthy();
  // The persistent dock is opt-in and must remain hidden for a fresh profile.
  await mainWindow.evaluate(() => window.ipc.invoke("dictation:updateState", { state: "idle" }));
  await expect
    .poll(() =>
      mainWindow.evaluate(async () => {
        const config = await window.ipc.invoke("transcription:getConfig", null);
        return config.dictation.showFlowBar;
      }),
    )
    .toBe(false);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith("/dictation.html"),
        );
        return overlay?.isVisible();
      }),
    )
    .toBe(false);

  // Enabling the setting reveals the idle dock immediately. A real modifier
  // event can arrive while Playwright is attaching, so normalize first.
  await mainWindow.evaluate(async () => {
    const config = await window.ipc.invoke("transcription:getConfig", null);
    await window.ipc.invoke("transcription:setConfig", {
      dictation: { ...config.dictation, showFlowBar: true },
    });
  });
  await expect(dictationWindow!.getByRole("button", { name: "Start dictation" })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith("/dictation.html"),
        );
        return { visible: overlay?.isVisible(), bounds: overlay?.getBounds() };
      }),
    )
    .toMatchObject({ visible: true, bounds: { width: 48, height: 34 } });
  // Exercise the renderer/main state bridge without capturing the developer's mic.
  await mainWindow.evaluate(() =>
    window.ipc.invoke("dictation:updateState", {
      state: "listening",
      message: "Desktop dictation test",
    }),
  );
  await expect(dictationWindow!.getByRole("status")).toContainText("Listening");
  await expect
    .poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Escape")))
    .toBe(true);

  // A native frameless drag emits BrowserWindow move events. Dropping near the
  // left edge must snap into the compact vertical layout and persist the choice.
  await app.evaluate(({ BrowserWindow, screen }) => {
    const overlay = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().endsWith("/dictation.html"),
    );
    if (!overlay) throw new Error("dictation overlay renderer was not created");
    const workArea = screen.getDisplayMatching(overlay.getBounds()).workArea;
    overlay.setPosition(workArea.x + 1, Math.round(workArea.y + workArea.height / 2));
  });
  await expect
    .poll(
      () =>
        mainWindow.evaluate(async () => {
          const config = await window.ipc.invoke("transcription:getConfig", null);
          return config.dictation.flowBarDock;
        }),
      { timeout: 5_000 },
    )
    .toBe("left");
  await expect(dictationWindow!.getByRole("status")).toHaveClass(/dock-left/);
  expect(
    await app.evaluate(({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().endsWith("/dictation.html"),
      );
      return overlay?.getBounds();
    }),
  ).toMatchObject({ width: 60, height: 156 });

  await mainWindow.evaluate(async () => {
    const config = await window.ipc.invoke("transcription:getConfig", null);
    await window.ipc.invoke("transcription:setConfig", {
      dictation: { ...config.dictation, flowBarDock: "bottom" },
    });
  });
  await expect(dictationWindow!.getByRole("status")).toHaveClass(/dock-bottom/);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith("/dictation.html"),
        );
        return overlay?.getBounds();
      }),
    )
    .toMatchObject({ width: 184, height: 40 });

  await mainWindow.evaluate(() => window.ipc.invoke("dictation:updateState", { state: "idle" }));
  await expect
    .poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Escape")))
    .toBe(false);
  await expect(dictationWindow!.getByRole("button", { name: "Start dictation" })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith("/dictation.html"),
        );
        return { visible: overlay?.isVisible(), bounds: overlay?.getBounds() };
      }),
    )
    .toMatchObject({ visible: true, bounds: { width: 48, height: 34 } });

  await mainWindow.evaluate(async () => {
    const config = await window.ipc.invoke("transcription:getConfig", null);
    await window.ipc.invoke("transcription:setConfig", {
      dictation: { ...config.dictation, showFlowBar: false },
    });
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith("/dictation.html"),
        );
        return overlay?.isVisible();
      }),
    )
    .toBe(false);

  await mainWindow.evaluate(async () => {
    const config = await window.ipc.invoke("transcription:getConfig", null);
    await window.ipc.invoke("transcription:setConfig", {
      dictation: { ...config.dictation, showFlowBar: true },
    });
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().endsWith("/dictation.html"),
        );
        return { visible: overlay?.isVisible(), bounds: overlay?.getBounds() };
      }),
    )
    .toMatchObject({ visible: true, bounds: { width: 48, height: 34 } });
});

test("packaged dictation follows ranked microphones through failover and reconnection", async () => {
  const dictationWindow = app
    .windows()
    .find((candidate) => candidate.url().endsWith("/dictation.html"));
  expect(dictationWindow, "dictation overlay renderer was not created").toBeTruthy();

  await dictationWindow!.evaluate(() => {
    type TestTrack = {
      label: string;
      readyState: MediaStreamTrackState;
      onended: (() => void) | null;
      getSettings: () => MediaTrackSettings;
      stop: () => void;
    };
    type DictationMicTestState = {
      calls: number;
      processorSize: number;
      tracks: TestTrack[];
      availableIds: string[];
      deviceChangeListeners: Set<() => void>;
    };

    const testWindow = window as typeof window & {
      __dictationMicTest?: DictationMicTestState;
    };
    const state: DictationMicTestState = {
      calls: 0,
      processorSize: 0,
      tracks: [],
      availableIds: ["test-mic-1", "test-mic-2"],
      deviceChangeListeners: new Set(),
    };
    testWindow.__dictationMicTest = state;

    const mediaDevices = {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        state.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 350));
        const audio = constraints.audio;
        const deviceConstraint = audio && typeof audio === "object" ? audio.deviceId : undefined;
        const exact =
          deviceConstraint && typeof deviceConstraint === "object"
            ? deviceConstraint.exact
            : undefined;
        const requestedId = typeof exact === "string" ? exact : undefined;
        if (requestedId && !state.availableIds.includes(requestedId)) {
          throw new DOMException("Microphone is unavailable", "NotFoundError");
        }
        const deviceId = requestedId ?? state.availableIds[0] ?? "system-default";
        const track: TestTrack = {
          label: deviceId === "test-mic-1" ? "Preferred Test Mic" : "Fallback Test Mic",
          readyState: "live",
          onended: null,
          getSettings: () => ({ deviceId }),
          stop() {
            this.readyState = "ended";
          },
        };
        state.tracks.push(track);
        return {
          getAudioTracks: () => [track],
          getTracks: () => [track],
        } as unknown as MediaStream;
      },
      enumerateDevices: async () =>
        state.availableIds.map(
          (deviceId) =>
            ({
              deviceId,
              groupId: "test-group",
              kind: "audioinput",
              label: deviceId === "test-mic-1" ? "Preferred Test Mic" : "Fallback Test Mic",
              toJSON: () => ({}),
            }) as MediaDeviceInfo,
        ),
      addEventListener: (event: string, listener: () => void) => {
        if (event === "devicechange") state.deviceChangeListeners.add(listener);
      },
      removeEventListener: (event: string, listener: () => void) => {
        if (event === "devicechange") state.deviceChangeListeners.delete(listener);
      },
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });

    class TestAudioContext {
      state: AudioContextState = "running";
      destination = {} as AudioDestinationNode;

      createMediaStreamSource() {
        return { connect: () => {}, disconnect: () => {} } as unknown as MediaStreamAudioSourceNode;
      }

      createScriptProcessor(size: number) {
        state.processorSize = size;
        return {
          onaudioprocess: null,
          connect: () => {},
          disconnect: () => {},
        } as unknown as ScriptProcessorNode;
      }

      async resume() {}
      async close() {}
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: TestAudioContext,
    });
  });

  // The persistent center bubble must start a real hands-free capture through
  // the main/renderer bridge, without stealing focus from the destination app.
  await dictationWindow!.getByRole("button", { name: "Start dictation" }).click();
  await expect(dictationWindow!.getByRole("status")).toContainText("Hands-free", {
    timeout: 5_000,
  });
  await expect(dictationWindow!.locator(".hint")).toHaveAttribute(
    "title",
    /Click ✓ to finish · .* also stops/,
  );
  await expect
    .poll(() =>
      dictationWindow!.evaluate(
        () =>
          (
            window as typeof window & {
              __dictationMicTest?: { calls: number };
            }
          ).__dictationMicTest?.calls,
      ),
    )
    .toBe(1);
  await dictationWindow!.getByRole("button", { name: "Cancel dictation" }).click();
  await expect(dictationWindow!.getByRole("button", { name: "Start dictation" })).toBeVisible();
  await dictationWindow!.evaluate(() => {
    const state = (
      window as typeof window & {
        __dictationMicTest?: { calls: number; tracks: unknown[] };
      }
    ).__dictationMicTest;
    if (state) {
      state.calls = 0;
      state.tracks = [];
    }
  });

  await app.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().endsWith("/dictation.html"),
    );
    overlay?.webContents.send("dictation:shortcut", {
      phase: "pressed",
      shortcut: "Control + Option",
      language: "en",
      microphonePriority: ["test-mic-1", "test-mic-2"],
    });
  });

  await expect(dictationWindow!.getByRole("status")).toContainText("Listening");
  await expect
    .poll(
      () =>
        dictationWindow!.evaluate(
          () =>
            (
              window as typeof window & {
                __dictationMicTest?: { calls: number };
              }
            ).__dictationMicTest?.calls,
        ),
      { timeout: 5_000 },
    )
    .toBe(1);

  // Reproduce a fast Escape/retry while the first wireless-style microphone
  // acquisition is still waking. The stale acquisition must not block or cancel
  // the replacement capture when it eventually resolves.
  await app.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().endsWith("/dictation.html"),
    );
    const event = {
      shortcut: "Control + Option",
      language: "en",
      microphonePriority: ["test-mic-1", "test-mic-2"],
    };
    overlay?.webContents.send("dictation:shortcut", { ...event, phase: "cancel" });
    overlay?.webContents.send("dictation:shortcut", { ...event, phase: "pressed" });
  });

  await expect
    .poll(
      () =>
        dictationWindow!.evaluate(
          () =>
            (
              window as typeof window & {
                __dictationMicTest?: { calls: number };
              }
            ).__dictationMicTest?.calls,
        ),
      { timeout: 5_000 },
    )
    .toBe(2);
  await expect(dictationWindow!.getByRole("status")).toContainText("Preferred Test Mic");
  expect(
    await dictationWindow!.evaluate(
      () =>
        (
          window as typeof window & {
            __dictationMicTest?: { processorSize: number };
          }
        ).__dictationMicTest?.processorSize,
    ),
  ).toBe(512);

  await dictationWindow!.evaluate(() => {
    const state = (
      window as typeof window & {
        __dictationMicTest?: {
          availableIds: string[];
          tracks: Array<{ readyState: MediaStreamTrackState; onended: (() => void) | null }>;
        };
      }
    ).__dictationMicTest;
    const track = [...(state?.tracks ?? [])].reverse().find((candidate) => candidate.readyState === "live");
    if (!track) throw new Error("test microphone did not start");
    state.availableIds = ["test-mic-2"];
    track.readyState = "ended";
    track.onended?.();
  });

  await expect
    .poll(
      () =>
        dictationWindow!.evaluate(
          () =>
            (
              window as typeof window & {
                __dictationMicTest?: { calls: number };
              }
            ).__dictationMicTest?.calls,
        ),
      { timeout: 5_000 },
    )
    .toBe(3);
  await expect(dictationWindow!.getByRole("status")).toContainText("Fallback Test Mic");

  await dictationWindow!.evaluate(() => {
    const state = (
      window as typeof window & {
        __dictationMicTest?: {
          availableIds: string[];
          deviceChangeListeners: Set<() => void>;
        };
      }
    ).__dictationMicTest;
    if (!state) throw new Error("microphone test state is missing");
    state.availableIds = ["test-mic-1", "test-mic-2"];
    state.deviceChangeListeners.forEach((listener) => listener());
  });

  await expect
    .poll(
      () =>
        dictationWindow!.evaluate(
          () =>
            (
              window as typeof window & {
                __dictationMicTest?: { calls: number };
              }
            ).__dictationMicTest?.calls,
        ),
      { timeout: 5_000 },
    )
    .toBe(4);
  await expect(dictationWindow!.getByRole("status")).toContainText("Preferred Test Mic");

  await app.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().endsWith("/dictation.html"),
    );
    overlay?.webContents.send("dictation:shortcut", {
      phase: "cancel",
      shortcut: "Control + Option",
      language: "en",
      microphonePriority: ["test-mic-1", "test-mic-2"],
    });
  });
});

test("packaged desktop dictation uses the fast local engine", async () => {
  test.skip(!EXPECT_FAST_ENGINE, "set DICTATION_E2E_EXPECT_FAST=1 after installing Parakeet v3");
  const mainWindow = app.windows().find((candidate) => !candidate.url().endsWith("dictation.html"));
  expect(mainWindow).toBeTruthy();

  const result = (await mainWindow!.evaluate(async (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return window.ipc.invoke("dictation:transcribe", {
      pcm16: bytes.buffer,
      sampleRate: 16000,
      channels: 1,
      lang: "en",
    });
  }, fixturePcmBase64())) as {
    success: boolean;
    text?: string;
    engine?: string;
    language?: string;
    durationMs?: number;
    code?: string;
  };

  expect(result.success, result.code ?? "dictation transcription failed").toBe(true);
  expect(result.engine).toBe("parakeet");
  expect(result.language).toBe("en");
  expect(result.text?.toLowerCase()).toContain("fox");
  process.stdout.write(
    `[dictation] packaged resident Parakeet latency: ${Math.round(result.durationMs ?? 0)}ms\n`,
  );
  expect(result.durationMs, "resident fast-engine latency regressed").toBeLessThan(350);
});

test("packaged desktop dictation persists cleanup, context, dictionary, and snippets", async () => {
  const mainWindow = app.windows().find((candidate) => !candidate.url().endsWith("dictation.html"));
  expect(mainWindow).toBeTruthy();

  expect(
    await mainWindow!.evaluate(() => window.ipc.invoke("dictation:getRecovery", null)),
  ).toEqual({ available: false, audioAvailable: false });
  expect(await mainWindow!.evaluate(() => window.ipc.invoke("dictation:copyLast", null))).toEqual({
    success: false,
    error: "No transcript is available yet.",
  });

  const requested: DictationSettings = {
    shortcut: "control-fn",
    flowBarDock: "right",
    showFlowBar: true,
    transformsEnabled: true,
    transforms: [
      {
        id: "polish",
        name: "Polish",
        instruction: "Fix grammar and preserve every URL.",
        shortcut: "option-1",
      },
      {
        id: "prompt-engineer",
        name: "Prompt Engineer",
        instruction: "Rewrite this as a precise prompt without dropping requirements.",
        shortcut: "option-2",
      },
      {
        id: "bullets",
        name: "Turn to bullets",
        instruction: "Turn this into a bullet list.",
        shortcut: "option-3",
      },
    ],
    language: "en",
    commandModeEnabled: true,
    retryFailedAudio: true,
    historyRetention: "forever",
    contextEnabled: false,
    cleanupLevel: "high",
    microphonePriority: [
      { deviceId: "test-mic-1", label: "Preferred Test Mic" },
      { deviceId: "test-mic-2", label: "Fallback Test Mic" },
    ],
    styles: {
      email: "formal",
      workMessaging: "very-casual",
      personalMessaging: "casual",
      other: "excited",
    },
    dictionary: [{ term: "Oppulence", replacementFor: "opulence", starred: true }],
    snippets: [{ trigger: "my signature", expansion: "Best,\nDan" }],
  };
  const saved = await mainWindow!.evaluate(
    (dictation) => window.ipc.invoke("transcription:setConfig", { dictation }),
    requested,
  );
  expect(saved.dictation).toEqual(requested);

  const reread = await mainWindow!.evaluate(() =>
    window.ipc.invoke("transcription:getConfig", null),
  );
  expect(reread.dictation).toEqual(requested);

  await expect
    .poll(
      () =>
        mainWindow!.evaluate(
          () => window.ipc.invoke("dictation:getStatus", null) as Promise<DictationStatus>,
        ),
      { timeout: 5_000 },
    )
    .toMatchObject({
      transformsEnabled: true,
      transformShortcutsReady: true,
    });
  expect(
    await app.evaluate(({ globalShortcut }) => ({
      polish: globalShortcut.isRegistered("Alt+1"),
      promptEngineer: globalShortcut.isRegistered("Alt+2"),
      bullets: globalShortcut.isRegistered("Alt+3"),
      unused: globalShortcut.isRegistered("Alt+4"),
    })),
  ).toEqual({ polish: true, promptEngineer: true, bullets: true, unused: false });

  await mainWindow!.evaluate(async () => {
    const config = await window.ipc.invoke("transcription:getConfig", null);
    await window.ipc.invoke("transcription:setConfig", {
      dictation: { ...config.dictation, transformsEnabled: false },
    });
  });
  await expect
    .poll(() =>
      app.evaluate(({ globalShortcut }) => [1, 2, 3].some((slot) =>
        globalShortcut.isRegistered(`Alt+${slot}`),
      )),
    )
    .toBe(false);

  await mainWindow!.evaluate(
    (dictation) => window.ipc.invoke("transcription:setConfig", { dictation }),
    requested,
  );

  await expect
    .poll(
      () =>
        mainWindow!.evaluate(
          () => window.ipc.invoke("dictation:getStatus", null) as Promise<DictationStatus>,
        ),
      { timeout: 15_000 },
    )
    .toMatchObject({
      monitorReady: true,
      shortcut: "Hold Control + Fn",
      transformsEnabled: true,
      transformShortcutsReady: true,
    });
});
