import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { DictationSettings } from "../packages/shared/src/transcription.ts";

import {
  DictationGestureController,
  flowBarBounds,
  nearestFlowBarDock,
  normalizeDictationText,
  parseHotkeyEvent,
} from "../apps/main/src/desktop-dictation-events.ts";
import {
  classifyDesktopApp,
  desktopCommandTargetUnchanged,
  parseDesktopContext,
} from "../apps/main/src/desktop-context.ts";
import { polishDictation } from "../apps/main/src/dictation-polish.ts";
import {
  DictationRecoveryStore,
  dictationRecoveryPreview,
} from "../apps/main/src/dictation-recovery.ts";
import { DictationAudioRecoveryStore } from "../apps/main/src/dictation-audio-recovery.ts";
import {
  calculateDictationStats,
  countDictationWords,
  DictationHistoryStore,
} from "../apps/main/src/dictation-history.ts";
import {
  rankedAvailableMicrophoneIds,
  uniqueMicrophonePriority,
} from "../apps/renderer/src/lib/dictation-microphones.ts";
import { prepareVoiceCapture } from "../apps/renderer/src/lib/voice-capture-startup.ts";
import {
  countDictationTransformWords,
  dictationTransformAccelerator,
  validateDictationTransformContext,
} from "../apps/main/src/dictation-transforms.ts";

const dictationSettings: DictationSettings = {
  shortcut: "control-option",
  flowBarDock: "bottom",
  showFlowBar: true,
  transformsEnabled: false,
  transforms: [],
  language: "auto",
  commandModeEnabled: true,
  retryFailedAudio: true,
  historyRetention: "forever",
  contextEnabled: true,
  cleanupLevel: "medium",
  microphonePriority: [],
  styles: {
    email: "formal",
    workMessaging: "casual",
    personalMessaging: "very-casual",
    other: "formal",
  },
  dictionary: [
    { term: "Oppulence", replacementFor: "opulence", starred: true },
    { term: "API", starred: false },
    { term: "Sarah", starred: false },
  ],
  snippets: [
    { trigger: "my email", expansion: "wrong-short-trigger@example.com" },
    { trigger: "my email address", expansion: "dan@example.com" },
  ],
};

test("parses modifier shortcut transitions from the native helper", () => {
  assert.deepEqual(parseHotkeyEvent('{"phase":"pressed","type":"hotkey"}'), {
    type: "hotkey",
    phase: "pressed",
  });
  assert.deepEqual(parseHotkeyEvent('{"type":"hotkey","phase":"released"}'), {
    type: "hotkey",
    phase: "released",
  });
});

test("accepts the helper readiness event", () => {
  assert.deepEqual(parseHotkeyEvent('{"type":"hotkey","phase":"ready"}'), {
    type: "hotkey",
    phase: "ready",
  });
});

test("recognizes direct and double-tap hands-free gestures without ending capture", () => {
  let now = 0;
  let pendingTimer: (() => void) | null = null;
  const actions: string[] = [];
  const controller = new DictationGestureController((action) => actions.push(action), {
    now: () => now,
    setTimer: (callback) => {
      pendingTimer = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pendingTimer = null;
    },
  });

  controller.handle("pressed");
  now = 100;
  controller.handle("released");
  now = 180;
  controller.handle("pressed");
  now = 220;
  controller.handle("released");
  assert.deepEqual(actions, ["pressed", "hands-free-locked"]);
  assert.equal(controller.isLocked(), true);

  controller.handle("hands-free-toggle");
  controller.handle("released");
  assert.deepEqual(actions, ["pressed", "hands-free-locked", "hands-free-stop"]);
  assert.equal(controller.isLocked(), false);
  assert.equal(pendingTimer, null);
});

test("keeps long push-to-talk releases immediate and defers only a quick tap", () => {
  let now = 0;
  let pendingTimer: (() => void) | null = null;
  const actions: string[] = [];
  const controller = new DictationGestureController((action) => actions.push(action), {
    now: () => now,
    setTimer: (callback) => {
      pendingTimer = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pendingTimer = null;
    },
  });

  controller.handle("pressed");
  now = 900;
  controller.handle("released");
  assert.deepEqual(actions, ["pressed", "released"]);

  now = 1_000;
  controller.handle("pressed");
  now = 1_100;
  controller.handle("released");
  assert.deepEqual(actions, ["pressed", "released", "pressed"]);
  pendingTimer?.();
  assert.deepEqual(actions, ["pressed", "released", "pressed", "released"]);
});

test("ignores malformed or unrelated helper output", () => {
  assert.equal(parseHotkeyEvent("not json"), null);
  assert.equal(parseHotkeyEvent('{"type":"level","phase":"pressed"}'), null);
  assert.equal(parseHotkeyEvent('{"type":"hotkey","phase":"repeat"}'), null);
});

test("trims transcription before inserting it into another app", () => {
  assert.equal(normalizeDictationText("  hello desktop  \n"), "hello desktop");
});

test("snaps the Flow Bar to the nearest supported screen edge", () => {
  const workArea = { x: 0, y: 0, width: 1_440, height: 900 };
  assert.equal(
    nearestFlowBarDock({ x: 4, y: 300, width: 420, height: 56 }, workArea),
    "left",
  );
  assert.equal(
    nearestFlowBarDock({ x: 1_016, y: 300, width: 420, height: 56 }, workArea),
    "right",
  );
  assert.equal(
    nearestFlowBarDock({ x: 510, y: 840, width: 420, height: 56 }, workArea),
    "bottom",
  );
});

test("lays out horizontal and vertical Flow Bars inside the display work area", () => {
  const workArea = { x: 0, y: 0, width: 1_440, height: 900 };
  assert.deepEqual(flowBarBounds("bottom", workArea), {
    x: 510,
    y: 820,
    width: 420,
    height: 56,
  });
  assert.deepEqual(flowBarBounds("left", workArea), {
    x: 24,
    y: 310,
    width: 112,
    height: 280,
  });
  assert.deepEqual(flowBarBounds("right", workArea), {
    x: 1_304,
    y: 310,
    width: 112,
    height: 280,
  });
  assert.deepEqual(flowBarBounds("bottom", workArea, true), {
    x: 654,
    y: 834,
    width: 132,
    height: 42,
  });
  assert.deepEqual(flowBarBounds("left", workArea, true), {
    x: 24,
    y: 392,
    width: 58,
    height: 116,
  });
});

test("maps opt-in Quick Transform slots to native macOS Option shortcuts", () => {
  assert.equal(dictationTransformAccelerator("option-1"), "Alt+1");
  assert.equal(dictationTransformAccelerator("option-5"), "Alt+5");
  assert.equal(dictationTransformAccelerator("option-9"), "Alt+9");
});

test("requires an exact, non-sensitive selection of at most 1,000 words for transforms", () => {
  const base = {
    appName: "Notes",
    bundleIdentifier: "com.apple.Notes",
    appCategory: "other" as const,
    sensitive: false,
    beforeText: "before ",
    selectedText: "rewrite this",
    selectedTextLength: 12,
    afterText: " after",
  };
  assert.deepEqual(validateDictationTransformContext(base), {
    ok: true,
    selectedText: "rewrite this",
    wordCount: 2,
  });
  assert.deepEqual(validateDictationTransformContext({ ...base, sensitive: true }), {
    ok: false,
    error: "Quick Transforms are unavailable in password fields.",
  });
  assert.deepEqual(
    validateDictationTransformContext({ ...base, selectedText: "", selectedTextLength: 0 }),
    { ok: false, error: "Select some text before using a Quick Transform." },
  );
  assert.match(
    validateDictationTransformContext({
      ...base,
      selectedTextLength: base.selectedText.length + 1,
    }).error ?? "",
    /too large/i,
  );
  const tooManyWords = Array.from({ length: 1_001 }, () => "word").join(" ");
  assert.equal(countDictationTransformWords(tooManyWords), 1_001);
  assert.deepEqual(
    validateDictationTransformContext({
      ...base,
      selectedText: tooManyWords,
      selectedTextLength: tooManyWords.length,
    }),
    { ok: false, error: "Quick Transforms support selections of up to 1,000 words." },
  );
});

test("resolves ranked microphones against currently available physical inputs", () => {
  assert.deepEqual(
    rankedAvailableMicrophoneIds(
      [
        { kind: "audioinput", deviceId: "default" },
        { kind: "audioinput", deviceId: "built-in" },
        { kind: "videoinput", deviceId: "camera" },
        { kind: "audioinput", deviceId: "headset" },
      ],
      ["headset", "missing", "built-in", "headset"],
    ),
    ["headset", "built-in"],
  );
  assert.deepEqual(uniqueMicrophonePriority([" headset ", "", "headset", " built-in"]), [
    "headset",
    "built-in",
  ]);
});

test("opens the microphone before provider IPC and does not wait for cloud transport", async () => {
  const events: string[] = [];
  let finishCloudTransport: (() => void) | undefined;
  const stream = { id: "test-stream" };

  const startup = await prepareVoiceCapture({
    openMicrophone: async () => {
      events.push("microphone");
      return stream;
    },
    resolveProvider: async () => {
      events.push("provider");
      return "deepgram" as const;
    },
    connectCloudTransport: async () => {
      events.push("cloud");
      await new Promise<void>((resolve) => {
        finishCloudTransport = resolve;
      });
    },
    disposeMicrophone: () => events.push("disposed"),
  });

  assert.deepEqual(events, ["microphone", "provider", "cloud"]);
  assert.equal(startup.stream, stream);
  finishCloudTransport?.();
  await startup.cloudTransportPromise;
});

test("disposes a microphone opened while no transcription provider is available", async () => {
  const stream = { stopped: false };
  const startup = await prepareVoiceCapture({
    openMicrophone: async () => stream,
    resolveProvider: async () => "none" as const,
    connectCloudTransport: async () => assert.fail("cloud transport should not start"),
    disposeMicrophone: (openedStream) => {
      openedStream.stopped = true;
    },
  });

  assert.equal(startup.stream, null);
  assert.equal(stream.stopped, true);
});

test("applies progressively stronger Auto Cleanup levels without losing raw intent", () => {
  const raw = "um I just wanted to meet at 5 actually 6 in order to review this period";
  const withCleanup = (cleanupLevel: DictationSettings["cleanupLevel"]) =>
    polishDictation(raw, { settings: { ...dictationSettings, cleanupLevel }, language: "en" });

  assert.deepEqual(withCleanup("none"), { text: raw, pressEnter: false, changes: [] });
  assert.deepEqual(withCleanup("light"), {
    text: "I just wanted to meet at 5 actually 6 in order to review this.",
    pressEnter: false,
    changes: ["fillers", "formatting"],
  });
  assert.deepEqual(withCleanup("medium"), {
    text: "I just wanted to meet at 6 in order to review this.",
    pressEnter: false,
    changes: ["fillers", "backtrack", "formatting"],
  });
  assert.deepEqual(withCleanup("high"), {
    text: "I wanted to meet at 6 to review this.",
    pressEnter: false,
    changes: ["fillers", "backtrack", "brevity", "formatting"],
  });
});

test("cleans filler words and spoken formatting without an AI round-trip", () => {
  assert.deepEqual(polishDictation("um hello comma new line uh this is fast exclamation point"), {
    text: "Hello,\nThis is fast!",
    pressEnter: false,
    changes: ["fillers", "formatting"],
  });
});

test("resolves clear self-corrections while preserving ordinary uses of actually", () => {
  assert.equal(polishDictation("Let's meet at 5 actually 6 pm.").text, "Let's meet at 6 pm.");
  assert.equal(
    polishDictation("I actually enjoyed the movie.").text,
    "I actually enjoyed the movie.",
  );
  assert.equal(
    polishDictation("I wanted to buy it as a gift as a present.").text,
    "I wanted to buy it as a present.",
  );
});

test("formats explicit spoken lists", () => {
  assert.equal(
    polishDictation("My top goals are one finish the report two send the presentation").text,
    "My top goals are:\n1. Finish the report\n2. Send the presentation",
  );
});

test("strips a trailing press-enter command and reports the action separately", () => {
  assert.deepEqual(polishDictation("hello world. Press enter."), {
    text: "Hello world.",
    pressEnter: true,
    changes: ["press-enter"],
  });
});

test("does not run English filler or command cleanup on other languages", () => {
  assert.deepEqual(polishDictation("um artigo press enter", { language: "pt" }), {
    text: "um artigo press enter",
    pressEnter: false,
    changes: [],
  });
});

test("applies French narrow no-break spacing outside developer apps", () => {
  assert.equal(
    polishDictation("Bonjour ! Comment ça va ? « très bien »", { language: "fr" }).text,
    "Bonjour\u202f! Comment ça va\u202f? «\u202ftrès bien\u202f»",
  );
  assert.equal(
    polishDictation("const answer: string = value;", {
      language: "fr",
      context: {
        appName: "Visual Studio Code",
        bundleIdentifier: "com.microsoft.VSCode",
        appCategory: "other",
        sensitive: false,
        beforeText: "",
        selectedText: "",
        selectedTextLength: 0,
        afterText: "",
      },
    }).text,
    "const answer: string = value;",
  );
});

test("classifies native and browser messaging/email targets", () => {
  assert.equal(classifyDesktopApp("Slack", "com.tinyspeck.slackmacgap"), "work-messaging");
  assert.equal(
    classifyDesktopApp("Google Chrome", "com.google.Chrome", "https://mail.google.com/mail/u/0"),
    "email",
  );
  assert.equal(classifyDesktopApp("Messages", "com.apple.MobileSMS"), "personal-messaging");
  assert.equal(classifyDesktopApp("TextEdit", "com.apple.TextEdit"), "other");
});

test("bounds nearby context and drops all password-field text", () => {
  const bounded = parseDesktopContext(
    JSON.stringify({
      type: "desktopContext",
      appName: "Slack",
      beforeText: "a".repeat(300),
      selectedText: "b".repeat(9_000),
      selectedTextLength: 9_000,
      afterText: "c".repeat(300),
      sensitive: false,
    }),
  );
  assert.equal(bounded?.beforeText.length, 256);
  assert.equal(bounded?.selectedText.length, 8_000);
  assert.equal(bounded?.selectedTextLength, 9_000);
  assert.equal(bounded?.afterText.length, 256);

  const sensitive = parseDesktopContext(
    JSON.stringify({
      type: "desktopContext",
      appName: "Safari",
      beforeText: "secret-before",
      selectedText: "secret-selected",
      afterText: "secret-after",
      sensitive: true,
    }),
  );
  assert.deepEqual(
    [sensitive?.beforeText, sensitive?.selectedText, sensitive?.afterText],
    ["", "", ""],
  );
  assert.equal(sensitive?.selectedTextLength, 0);
});

test("Command Mode replaces only the exact original selection in the same app", () => {
  const expected = parseDesktopContext(
    JSON.stringify({
      type: "desktopContext",
      appName: "Notes",
      bundleIdentifier: "com.apple.Notes",
      beforeText: "before ",
      selectedText: "rewrite me",
      selectedTextLength: 10,
      afterText: " after",
      sensitive: false,
    }),
  );
  assert.ok(expected);
  assert.equal(desktopCommandTargetUnchanged(expected, { ...expected }), true);
  assert.equal(
    desktopCommandTargetUnchanged(expected, { ...expected, selectedText: "different!" }),
    false,
  );
  assert.equal(
    desktopCommandTargetUnchanged(expected, {
      ...expected,
      appName: "Mail",
      bundleIdentifier: "com.apple.mail",
    }),
    false,
  );
  assert.equal(desktopCommandTargetUnchanged(expected, { ...expected, sensitive: true }), false);
});

test("applies dictionary corrections and the longest matching snippet locally", () => {
  const result = polishDictation("opulence supports api. send it to my email address.", {
    settings: dictationSettings,
  });
  assert.equal(result.text, "Oppulence supports API. Send it to dan@example.com.");
  assert.deepEqual(result.changes, ["dictionary", "snippet"]);
});

test("uses nearby text and app style for seamless message continuation", () => {
  const result = polishDictation("Let's sync tomorrow.", {
    settings: dictationSettings,
    context: {
      appName: "Slack",
      bundleIdentifier: "com.tinyspeck.slackmacgap",
      appCategory: "work-messaging",
      sensitive: false,
      beforeText: "sounds good",
      selectedText: "",
      selectedTextLength: 0,
      afterText: "",
    },
  });
  assert.equal(result.text, " let's sync tomorrow");
  assert.deepEqual(result.changes, ["context", "style"]);
});

test("preserves visible or dictionary proper nouns when continuing mid-sentence", () => {
  const result = polishDictation("Sarah will follow up.", {
    settings: dictationSettings,
    context: {
      appName: "Mail",
      appCategory: "email",
      sensitive: false,
      beforeText: "Please ask ",
      selectedText: "",
      selectedTextLength: 0,
      afterText: "",
    },
  });
  assert.equal(result.text, "Sarah will follow up.");
  assert.deepEqual(result.changes, []);
});

test("durably replaces the one-item local transcript recovery record", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-recovery-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "dictation-recovery.json");
  const store = new DictationRecoveryStore(file);

  await store.save("First transcript", new Date("2026-08-02T12:00:00.000Z"));
  await store.save("Replacement transcript", new Date("2026-08-02T12:01:00.000Z"));

  assert.deepEqual(await store.read(), {
    text: "Replacement transcript",
    createdAt: "2026-08-02T12:01:00.000Z",
  });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test("returns a bounded single-line recovery preview and ignores corrupt state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-recovery-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "dictation-recovery.json");
  const store = new DictationRecoveryStore(file);

  assert.deepEqual(
    dictationRecoveryPreview(
      { text: "hello\nworld and more", createdAt: "2026-08-02T12:00:00Z" },
      12,
    ),
    { available: true, preview: "hello world…", createdAt: "2026-08-02T12:00:00Z" },
  );
  await fs.writeFile(file, "{not-json", "utf8");
  assert.equal(await store.read(), null);
  assert.deepEqual(dictationRecoveryPreview(null), { available: false });
});

test("keeps failed PCM owner-only and expires it after fourteen days", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-audio-retry-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationAudioRecoveryStore(directory);
  const capturedAt = new Date("2026-08-02T12:00:00.000Z");
  const samples = Int16Array.from({ length: 32_000 }, (_value, index) => index % 1_000);

  const staged = await store.stage(samples, 16_000, capturedAt);
  assert.deepEqual(await store.summary(capturedAt), {
    available: true,
    createdAt: capturedAt.toISOString(),
    durationMs: 2_000,
    errorCode: "interrupted",
  });
  await store.markFailed(
    staged,
    "engine_crashed",
    "local inference stopped",
    "7c4f21c6-1c63-4e93-9aba-84d79305fef0",
  );
  const recovered = await store.read(capturedAt);
  assert.equal(recovered?.errorCode, "engine_crashed");
  assert.equal(recovered?.historyId, "7c4f21c6-1c63-4e93-9aba-84d79305fef0");
  assert.deepEqual(recovered?.pcm16, samples);

  const files = await fs.readdir(directory);
  for (const file of files)
    assert.equal((await fs.stat(path.join(directory, file))).mode & 0o777, 0o600);

  const expiredAt = new Date(capturedAt.getTime() + 14 * 24 * 60 * 60 * 1_000);
  assert.equal(await store.read(expiredAt), null);
  assert.deepEqual(await fs.readdir(directory), []);
});

test("successful dictation discards staged retry audio", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-audio-retry-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationAudioRecoveryStore(directory);
  const staged = await store.stage(new Int16Array(16_000));
  await store.discard(staged);
  assert.deepEqual(await store.summary(), { available: false });
  assert.deepEqual(await fs.readdir(directory), []);
});

test("a successful new dictation preserves an older failed retry item", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-audio-retry-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationAudioRecoveryStore(directory);
  const olderSamples = Int16Array.from([10, 20, 30, 40]);
  const older = await store.stage(olderSamples);
  await store.markFailed(older, "engine_crashed");

  const successful = await store.stage(Int16Array.from([50, 60, 70, 80]));
  await store.discard(successful);

  assert.deepEqual((await store.read())?.pcm16, olderSamples);
  assert.equal((await store.read())?.errorCode, "engine_crashed");
});

test("a newer failed dictation replaces the previous retry item", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-audio-retry-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationAudioRecoveryStore(directory);
  const older = await store.stage(Int16Array.from([10, 20, 30, 40]));
  await store.markFailed(older, "engine_crashed");
  const newerSamples = Int16Array.from([50, 60, 70, 80]);
  const newer = await store.stage(newerSamples);
  await store.markFailed(newer, "cloud_transcription_failed");

  assert.deepEqual((await store.read())?.pcm16, newerSamples);
  assert.equal((await store.read())?.errorCode, "cloud_transcription_failed");
  assert.equal((await fs.readdir(directory)).length, 2);
});

test("counts multilingual dictation words without relying on whitespace", () => {
  assert.equal(countDictationWords("hello from Oppulence"), 3);
  assert.ok(countDictationWords("你好世界，这是一个测试。") > 1);
});

test("stores searchable owner-only history and computes weighted dictation stats", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-history-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "dictation-history.json");
  const store = new DictationHistoryStore(file);
  const today = new Date(2026, 7, 3, 12);
  const yesterday = new Date(2026, 7, 2, 12);

  await store.add(
    {
      text: "one two three four",
      appName: "Mail",
      engine: "parakeet",
      audioDurationMs: 2_000,
      transcriptionDurationMs: 220,
      createdAt: today,
    },
    "forever",
  );
  await store.add(
    {
      text: "five six",
      appName: "Slack",
      engine: "whisper",
      audioDurationMs: 1_000,
      createdAt: yesterday,
    },
    "forever",
  );

  const page = await store.list({ query: "mail", limit: 10 }, "forever", today);
  assert.equal(page.total, 1);
  assert.equal(page.entries[0]?.appName, "Mail");
  assert.deepEqual(page.stats, {
    totalWords: 6,
    todayWords: 4,
    averageWpm: 120,
    streakDays: 2,
    daysUsed: 2,
    totalDictations: 2,
    totalAudioDurationMs: 3_000,
    automaticallyEditedDictations: 0,
    wordsCleanedUp: 0,
    topApps: [
      { appName: "Mail", dictations: 1 },
      { appName: "Slack", dictations: 1 },
    ],
  });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test("keeps raw and polished transcripts so Smart Formatting can be undone and redone", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-history-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationHistoryStore(path.join(directory, "dictation-history.json"));

  const saved = await store.add(
    {
      text: "Hello.",
      rawText: "um hello period",
      polishChanges: ["fillers", "formatting"],
      engine: "parakeet",
      audioDurationMs: 1_500,
    },
    "forever",
  );

  assert.ok(saved);
  assert.equal(saved.text, "Hello.");
  assert.equal(saved.rawText, "um hello period");
  assert.equal(saved.polishedText, "Hello.");
  assert.deepEqual(saved.polishChanges, ["fillers", "formatting"]);
  assert.equal(saved.formattingUndone, false);
  assert.equal(saved.wordCount, 3);

  const rawSearch = await store.list({ query: "period" });
  assert.equal(rawSearch.total, 1);
  assert.equal(rawSearch.stats.automaticallyEditedDictations, 1);
  assert.equal(rawSearch.stats.wordsCleanedUp, 2);

  const undone = await store.toggleFormatting(saved.id);
  assert.equal(undone?.text, "um hello period");
  assert.equal(undone?.formattingUndone, true);

  const redone = await store.toggleFormatting(saved.id);
  assert.equal(redone?.text, "Hello.");
  assert.equal(redone?.formattingUndone, false);
});

test("atomically serializes concurrent history writes and honors privacy retention", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-history-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationHistoryStore(path.join(directory, "dictation-history.json"));
  const now = new Date(2026, 7, 3, 12);

  await Promise.all(
    Array.from({ length: 20 }, (_value, index) =>
      store.add(
        {
          text: `Concurrent transcript ${index}`,
          audioDurationMs: 1_000,
          createdAt: new Date(now.getTime() - index * 1_000),
        },
        "forever",
      ),
    ),
  );
  await store.add(
    { text: "Expired transcript", createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1_000) },
    "forever",
  );
  assert.equal((await store.list({ limit: 200 }, "forever", now)).total, 21);
  assert.equal((await store.list({ limit: 200 }, "24-hours", now)).total, 20);

  await store.applyRetention("never", now);
  assert.equal((await store.list({}, "never", now)).total, 0);
});

test("replaces a failed history row in place after retry", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oppulence-history-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DictationHistoryStore(path.join(directory, "dictation-history.json"));
  const failed = await store.add(
    { text: "", status: "failed", errorCode: "engine_crashed", appName: "Notes" },
    "forever",
  );
  assert.ok(failed);

  const completed = await store.complete(
    failed.id,
    {
      text: "Recovered transcript",
      delivery: "none",
      engine: "parakeet",
      audioDurationMs: 1_500,
    },
    "forever",
  );
  assert.equal(completed?.id, failed.id);
  assert.equal(completed?.status, "success");
  assert.equal(completed?.errorCode, undefined);
  assert.equal((await store.list()).total, 1);
});

test("calculates an inactive streak as of yesterday and zero for an older gap", () => {
  const now = new Date(2026, 7, 3, 12);
  const base = {
    id: "7c4f21c6-1c63-4e93-9aba-84d79305fef0",
    text: "hello",
    status: "success" as const,
    delivery: "pasted" as const,
    engine: "parakeet" as const,
    audioDurationMs: 1_000,
    wordCount: 1,
  };
  assert.equal(
    calculateDictationStats([{ ...base, createdAt: new Date(2026, 7, 2, 12).toISOString() }], now)
      .streakDays,
    1,
  );
  assert.equal(
    calculateDictationStats([{ ...base, createdAt: new Date(2026, 7, 1, 12).toISOString() }], now)
      .streakDays,
    0,
  );
});
