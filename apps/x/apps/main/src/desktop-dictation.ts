import {
  BrowserWindow,
  app,
  clipboard,
  globalShortcut,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { execFile } from "node:child_process";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { WorkDir } from "@x/core/dist/config/config.js";
import { transformDictationCommand } from "@x/core/dist/voice/command-mode.js";
import { getTranscriptionConfig, setTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import {
  DICTATION_LANGUAGE_LABELS,
  DICTATION_SHORTCUT_LABELS,
  type DictationHistoryEngine,
  type DictationHistoryEntry,
  type DictationHistoryRetention,
  type DictationFlowBarDock,
  type DictationLanguage,
  type DictationSettings,
  type DictationShortcut,
  type DictationTransform,
} from "@x/shared/dist/transcription.js";

import { audiocapBinaryPath } from "./meeting-capture.js";
import { markSecondaryWindow, preloadPath } from "./main-window.js";
import { captureDesktopContext, desktopCommandTargetUnchanged } from "./desktop-context.js";
import { DictationAudioRecoveryStore } from "./dictation-audio-recovery.js";
import {
  DictationHistoryStore,
  type DictationHistoryInput,
  type DictationHistoryPage,
} from "./dictation-history.js";
import {
  DictationGestureController,
  flowBarBounds,
  nearestFlowBarDock,
  parseHotkeyEvent,
  type DictationShortcutAction,
} from "./desktop-dictation-events.js";
import { DictationRecoveryStore, dictationRecoveryPreview } from "./dictation-recovery.js";
import {
  dictationTransformAccelerator,
  validateDictationTransformContext,
} from "./dictation-transforms.js";
import { polishDictation } from "./dictation-polish.js";
import { stopFastDictationEngine, warmFastDictationEngine } from "./parakeet-dictation-runner.js";
import type { DesktopTextContext } from "./desktop-context.js";

export type DesktopDictationState = "idle" | "listening" | "transcribing" | "success" | "error";

const execFileAsync = promisify(execFile);
const FALLBACK_ACCELERATOR = "Command+Shift+Space";
const PASTE_LAST_ACCELERATOR = "Command+Control+V";
const COPY_LAST_ACCELERATOR = "Command+Control+C";
const RETRY_FAILED_ACCELERATOR = "Command+Control+R";
const CANCEL_ACCELERATOR = "Escape";
const COMMAND_SHORTCUT = "command-control-option";
const COMMAND_SHORTCUT_LABEL = "Command + Control + Option";
const INPUT_MONITORING_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";

let dictationWindow: BrowserWindow | null = null;
let hotkeyMonitor: ChildProcessWithoutNullStreams | null = null;
let hotkeyBuffer = "";
let monitorReady = false;
let monitorError: string | undefined;
let commandHotkeyMonitor: ChildProcessWithoutNullStreams | null = null;
let commandHotkeyBuffer = "";
let commandMonitorReady = false;
let commandMonitorError: string | undefined;
let commandModeEnabled = true;
let transformsEnabled = false;
let transformShortcutError: string | undefined;
const registeredTransformAccelerators = new Set<string>();
let activeTransformPromise: Promise<void> | null = null;
let currentDesktopDictationState: DesktopDictationState = "idle";
let rendererReady = false;
type DesktopShortcutAction =
  | DictationShortcutAction
  | "command-pressed"
  | "command-released"
  | "cancel"
  | "retry";
const pendingPhases: Array<{
  phase: DesktopShortcutAction;
  language: DictationLanguage;
  microphonePriority: string[];
}> = [];
let fallbackActive = false;
let fallbackLastAt = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let dockSnapTimer: ReturnType<typeof setTimeout> | null = null;
let preparedContext: Promise<DesktopTextContext | null> | null = null;
let preparedCommandContext: Promise<DesktopTextContext | null> | null = null;
let activeShortcut: DictationShortcut = "control-option";
let activeFlowBarDock: DictationFlowBarDock = "bottom";
let activeShowFlowBar = true;
let activeLanguage: DictationLanguage = "auto";
let activeMicrophonePriority: string[] = [];
let languageChangedListener: (() => void) | null = null;
const recoveryStore = new DictationRecoveryStore(
  path.join(WorkDir, "config", "dictation-recovery.json"),
);
const audioRecoveryStore = new DictationAudioRecoveryStore(
  path.join(WorkDir, "recovery", "dictation"),
);
const historyStore = new DictationHistoryStore(
  path.join(WorkDir, "config", "dictation-history.json"),
);

export function desktopDictationAudioRecoveryStore(): DictationAudioRecoveryStore {
  return audioRecoveryStore;
}

export interface DesktopDictationCommitMetadata {
  audioDurationMs?: number;
  transcriptionDurationMs?: number;
  engine?: DictationHistoryEngine;
  language?: DictationLanguage;
  historyId?: string;
}

export function notifyDesktopDictationHistoryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("dictation:historyChanged", {});
  }
}

export async function getDesktopDictationHistory(
  options: { query?: string; limit?: number; offset?: number },
  retention: DictationHistoryRetention,
): Promise<DictationHistoryPage> {
  const [page, retryAudio] = await Promise.all([
    historyStore.list(options, retention),
    audioRecoveryStore.read(),
  ]);
  return {
    ...page,
    entries: page.entries.map((entry) => ({
      ...entry,
      ...(entry.status === "failed" ? { retryAvailable: retryAudio?.historyId === entry.id } : {}),
    })),
  };
}

export async function copyDesktopDictationHistoryEntry(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const entry = await historyStore.find(id);
  if (!entry?.text) return { success: false, error: "That transcript is no longer available." };
  clipboard.writeText(entry.text);
  return { success: true };
}

export async function toggleDesktopDictationHistoryFormatting(
  id: string,
): Promise<DictationHistoryEntry | null> {
  const entry = await historyStore.toggleFormatting(id);
  if (entry) notifyDesktopDictationHistoryChanged();
  return entry;
}

export async function deleteDesktopDictationHistoryEntry(id: string): Promise<boolean> {
  const retryAudio = await audioRecoveryStore.read();
  if (retryAudio?.historyId === id) await audioRecoveryStore.clear();
  const deleted = await historyStore.delete(id);
  if (deleted) notifyDesktopDictationHistoryChanged();
  return deleted;
}

export async function clearDesktopDictationHistory(): Promise<void> {
  await Promise.all([historyStore.clear(), audioRecoveryStore.clear()]);
  notifyDesktopDictationHistoryChanged();
}

export async function applyDesktopDictationHistoryRetention(
  retention: DictationHistoryRetention,
): Promise<void> {
  await historyStore.applyRetention(retention);
  notifyDesktopDictationHistoryChanged();
}

export async function recordFailedDesktopDictation(
  input: Pick<DictationHistoryInput, "audioDurationMs" | "engine" | "errorCode" | "language">,
  retention: DictationHistoryRetention,
): Promise<string | undefined> {
  const contextPromise = preparedContext;
  preparedContext = null;
  const context = await (contextPromise ?? captureDesktopContext(audiocapBinaryPath(), false));
  if (context?.sensitive) return undefined;
  const entry = await historyStore.add(
    {
      text: "",
      status: "failed",
      delivery: "none",
      appName: context?.appName,
      bundleIdentifier: context?.bundleIdentifier,
      ...input,
    },
    retention,
  );
  if (entry) notifyDesktopDictationHistoryChanged();
  return entry?.id;
}

/** Retry from Home updates the failed row without pasting into Oppulence's own UI. */
export async function completeFailedDesktopDictationHistory(
  id: string,
  rawText: string,
  settings: DictationSettings,
  metadata: DesktopDictationCommitMetadata,
): Promise<boolean> {
  const { text, changes } = polishDictation(rawText, {
    settings,
    context: null,
    language: metadata.language,
  });
  if (!text) return false;
  await recoveryStore.save(text).catch((error) => {
    console.warn("[dictation] could not save recovered transcript", error);
  });
  const entry = await historyStore.complete(
    id,
    {
      text,
      rawText,
      polishChanges: changes,
      status: "success",
      delivery: "none",
      engine: metadata.engine,
      language: metadata.language,
      audioDurationMs: metadata.audioDurationMs,
      transcriptionDurationMs: metadata.transcriptionDurationMs,
    },
    settings.historyRetention,
  );
  if (entry) notifyDesktopDictationHistoryChanged();
  return Boolean(entry);
}

function shortcutLabel(shortcut = activeShortcut): string {
  return DICTATION_SHORTCUT_LABELS[shortcut];
}

function actionShortcutLabel(phase: DesktopShortcutAction): string {
  return phase === "command-pressed" || phase === "command-released"
    ? COMMAND_SHORTCUT_LABEL
    : shortcutLabel();
}

function dictationUrl(): string {
  return app.isPackaged ? "app://-/dictation.html" : "http://localhost:5173/dictation.html";
}

function sameBounds(left: Electron.Rectangle, right: Electron.Rectangle): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function positionWindow(
  win: BrowserWindow,
  workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
): void {
  const nextBounds = flowBarBounds(
    activeFlowBarDock,
    workArea,
    currentDesktopDictationState === "idle",
  );
  if (!sameBounds(win.getBounds(), nextBounds)) win.setBounds(nextBounds, false);
}

function broadcastFlowBarDock(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("dictation:flowBarDockChanged", { dock: activeFlowBarDock });
    }
  }
}

function snapFlowBarAfterMove(win: BrowserWindow): void {
  if (dockSnapTimer) clearTimeout(dockSnapTimer);
  dockSnapTimer = setTimeout(() => {
    dockSnapTimer = null;
    if (win.isDestroyed()) return;
    const currentBounds = win.getBounds();
    const display = screen.getDisplayMatching(currentBounds);
    const nextDock = nearestFlowBarDock(currentBounds, display.workArea);
    const changed = nextDock !== activeFlowBarDock;
    activeFlowBarDock = nextDock;
    positionWindow(win, display.workArea);
    broadcastFlowBarDock();
    if (changed) {
      void setTranscriptionConfig({ dictation: { flowBarDock: nextDock } }).catch((error) => {
        console.warn("[dictation] could not persist Flow Bar dock", error);
      });
    }
  }, 180);
}

function ensureWindow(): BrowserWindow {
  if (dictationWindow && !dictationWindow.isDestroyed()) return dictationWindow;

  const win = new BrowserWindow({
    width: 420,
    height: 56,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      backgroundThrottling: false,
    },
  });

  dictationWindow = win;
  rendererReady = false;
  markSecondaryWindow(win);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The panel remains non-focusable, so dragging it never steals the destination
  // text field, but it must receive pointer input for native frameless dragging.
  win.setIgnoreMouseEvents(false);
  positionWindow(win);

  win.webContents.on("did-finish-load", () => {
    rendererReady = true;
    win.webContents.send("dictation:flowBarDockChanged", { dock: activeFlowBarDock });
    for (const pending of pendingPhases.splice(0)) {
      win.webContents.send("dictation:shortcut", {
        phase: pending.phase,
        shortcut: actionShortcutLabel(pending.phase),
        language: pending.language,
        microphonePriority: pending.microphonePriority,
      });
    }
    if (currentDesktopDictationState === "idle" && activeShowFlowBar) {
      positionWindow(win);
      win.showInactive();
    }
  });
  win.on("closed", () => {
    dictationWindow = null;
    rendererReady = false;
  });
  // macOS emits move events throughout a native title-bar drag. Debounce until
  // the pointer is released, then snap to the nearest supported work-area edge.
  win.on("move", () => snapFlowBarAfterMove(win));
  void win.loadURL(dictationUrl());
  return win;
}

function sendShortcut(phase: DesktopShortcutAction): void {
  const language = activeLanguage;
  const microphonePriority = [...activeMicrophonePriority];
  if (phase === "pressed" || (phase === "hands-free-locked" && !preparedContext)) {
    // Context capture runs while the user is speaking, in parallel with audio
    // capture and ASR. It therefore adds no release-to-paste latency.
    preparedContext = getTranscriptionConfig()
      .then((config) =>
        captureDesktopContext(audiocapBinaryPath(), config.dictation.contextEnabled),
      )
      .catch(() => null);
  }
  if (phase === "hands-free-locked") fallbackActive = true;
  else if (phase === "hands-free-stop" || phase === "cancel") fallbackActive = false;
  if (phase === "command-pressed") {
    preparedCommandContext = captureDesktopContext(audiocapBinaryPath(), true).catch(() => null);
  }
  const win = ensureWindow();
  if (phase === "pressed") updateDesktopDictationState("listening");
  else if (phase === "command-pressed") {
    updateDesktopDictationState("listening", "Listening for a command…");
  } else if (phase === "released" || phase === "hands-free-stop" || phase === "retry") {
    updateDesktopDictationState("transcribing");
  } else if (phase === "command-released") {
    updateDesktopDictationState("transcribing", "Applying command…");
  } else if (phase === "hands-free-locked") {
    updateDesktopDictationState("listening", "Hands-free listening…");
  } else if (phase === "cancel") {
    preparedCommandContext = null;
    updateDesktopDictationState("idle");
  }
  if (!rendererReady || win.webContents.isLoading()) {
    pendingPhases.push({ phase, language, microphonePriority });
    return;
  }
  win.webContents.send("dictation:shortcut", {
    phase,
    shortcut: actionShortcutLabel(phase),
    language,
    microphonePriority,
  });
}

const gestureController = new DictationGestureController(sendShortcut);

function handleHotkeyLine(line: string): void {
  const event = parseHotkeyEvent(line);
  if (!event) return;
  if (event.phase === "ready") {
    monitorReady = true;
    monitorError = undefined;
    return;
  }
  gestureController.handle(event.phase);
}

function startNativeMonitor(shortcut: DictationShortcut = activeShortcut): void {
  if (process.platform !== "darwin" || hotkeyMonitor) return;
  activeShortcut = shortcut;
  const binary = audiocapBinaryPath();
  if (!fs.existsSync(binary)) {
    monitorError = "The desktop shortcut helper is missing from this build.";
    return;
  }

  try {
    hotkeyBuffer = "";
    const child = spawn(binary, ["hotkey", "--shortcut", shortcut], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    hotkeyMonitor = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      hotkeyBuffer += chunk;
      let newline = hotkeyBuffer.indexOf("\n");
      while (newline >= 0) {
        handleHotkeyLine(hotkeyBuffer.slice(0, newline).trim());
        hotkeyBuffer = hotkeyBuffer.slice(newline + 1);
        newline = hotkeyBuffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) console.warn(`[dictation] shortcut helper: ${message}`);
    });
    child.on("error", (error) => {
      if (hotkeyMonitor !== child) return;
      monitorReady = false;
      monitorError = `Could not start the desktop shortcut: ${error.message}`;
      hotkeyMonitor = null;
    });
    child.on("exit", (code, signal) => {
      if (hotkeyMonitor !== child) return;
      monitorReady = false;
      hotkeyMonitor = null;
      if (code !== 0 && signal !== "SIGTERM") {
        monitorError = "The desktop shortcut stopped. Restart Oppulence to try again.";
      }
    });
  } catch (error) {
    monitorError = `Could not start the desktop shortcut: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function stopNativeMonitor(): void {
  const child = hotkeyMonitor;
  hotkeyMonitor = null;
  monitorReady = false;
  hotkeyBuffer = "";
  if (!child || child.killed) return;
  child.stdin.write("stop\n");
  child.kill("SIGTERM");
}

function handleCommandHotkeyLine(line: string): void {
  const event = parseHotkeyEvent(line);
  if (!event) return;
  if (event.phase === "ready") {
    commandMonitorReady = true;
    commandMonitorError = undefined;
    return;
  }
  if (!commandModeEnabled) return;
  if (event.phase === "pressed") sendShortcut("command-pressed");
  else if (event.phase === "released") sendShortcut("command-released");
}

function startCommandMonitor(): void {
  if (process.platform !== "darwin" || commandHotkeyMonitor || !commandModeEnabled) return;
  const binary = audiocapBinaryPath();
  if (!fs.existsSync(binary)) {
    commandMonitorError = "The Command Mode shortcut helper is missing from this build.";
    return;
  }
  try {
    commandHotkeyBuffer = "";
    const child = spawn(binary, ["hotkey", "--shortcut", COMMAND_SHORTCUT], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    commandHotkeyMonitor = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      commandHotkeyBuffer += chunk;
      let newline = commandHotkeyBuffer.indexOf("\n");
      while (newline >= 0) {
        handleCommandHotkeyLine(commandHotkeyBuffer.slice(0, newline).trim());
        commandHotkeyBuffer = commandHotkeyBuffer.slice(newline + 1);
        newline = commandHotkeyBuffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (message) console.warn(`[dictation] command shortcut helper: ${message}`);
    });
    child.on("error", (error) => {
      if (commandHotkeyMonitor !== child) return;
      commandMonitorReady = false;
      commandMonitorError = `Could not start Command Mode: ${error.message}`;
      commandHotkeyMonitor = null;
    });
    child.on("exit", (code, signal) => {
      if (commandHotkeyMonitor !== child) return;
      commandMonitorReady = false;
      commandHotkeyMonitor = null;
      if (code !== 0 && signal !== "SIGTERM") {
        commandMonitorError = "The Command Mode shortcut stopped. Restart Oppulence to retry.";
      }
    });
  } catch (error) {
    commandMonitorError = `Could not start Command Mode: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function stopCommandMonitor(): void {
  const child = commandHotkeyMonitor;
  commandHotkeyMonitor = null;
  commandMonitorReady = false;
  commandHotkeyBuffer = "";
  if (!child || child.killed) return;
  child.stdin.write("stop\n");
  child.kill("SIGTERM");
}

function unregisterTransformShortcuts(): void {
  for (const accelerator of registeredTransformAccelerators) {
    globalShortcut.unregister(accelerator);
  }
  registeredTransformAccelerators.clear();
}

async function applyDesktopQuickTransform(transform: DictationTransform): Promise<void> {
  updateDesktopDictationState("transcribing", `Reading selection for ${transform.name}…`);
  const context = await captureDesktopContext(audiocapBinaryPath(), true).catch(() => null);
  if (!context) {
    updateDesktopDictationState("error", "Could not read the focused text field.");
    return;
  }
  const validated = validateDictationTransformContext(context);
  if (!validated.ok) {
    updateDesktopDictationState("error", validated.error);
    return;
  }

  try {
    updateDesktopDictationState("transcribing", `${transform.name}…`);
    const cfg = await getTranscriptionConfig();
    const transformed = await transformDictationCommand({
      instruction: transform.instruction,
      selectedText: validated.selectedText,
      beforeText: context.beforeText,
      afterText: context.afterText,
      appName: context.appName,
      localOnly: cfg.privacy.localOnly,
    });
    if (transformed.text.trim() === validated.selectedText.trim()) {
      updateDesktopDictationState("success", `${transform.name}: no changes needed`);
      return;
    }
    const pasted = await pasteDesktopCommandResult(transformed.text, context);
    updateDesktopDictationState(
      pasted.success ? "success" : "error",
      pasted.success ? `${transform.name} applied · Command+Z to undo` : pasted.error,
    );
  } catch (error) {
    console.warn(`[dictation] Quick Transform ${transform.name} failed`, error);
    updateDesktopDictationState(
      "error",
      error instanceof Error && error.name === "DictationCommandPrivacyError"
        ? error.message
        : `${transform.name} could not finish. Your original text was not changed.`,
    );
  }
}

function runDesktopQuickTransform(transform: DictationTransform): void {
  if (
    activeTransformPromise ||
    currentDesktopDictationState === "listening" ||
    currentDesktopDictationState === "transcribing"
  ) {
    console.info(`[dictation] ignored ${transform.name}; dictation or another transform is active`);
    return;
  }
  const operation = applyDesktopQuickTransform(transform).finally(() => {
    if (activeTransformPromise === operation) activeTransformPromise = null;
  });
  activeTransformPromise = operation;
}

function registerTransformShortcuts(settings: DictationSettings): void {
  unregisterTransformShortcuts();
  transformsEnabled = settings.transformsEnabled;
  transformShortcutError = undefined;
  if (!transformsEnabled || process.platform !== "darwin") return;

  const claimed = new Set<string>();
  for (const transform of settings.transforms) {
    const accelerator = dictationTransformAccelerator(transform.shortcut);
    if (claimed.has(accelerator)) {
      transformShortcutError = `${transform.name} uses a Quick Transform shortcut that is already assigned.`;
      continue;
    }
    claimed.add(accelerator);
    const registered = globalShortcut.register(accelerator, () =>
      runDesktopQuickTransform(transform),
    );
    if (registered) registeredTransformAccelerators.add(accelerator);
    else {
      transformShortcutError = `${transform.name} could not use its shortcut because another app is using it.`;
    }
  }
}

export function applyDesktopDictationSettings(settings: DictationSettings): void {
  if (settings.shortcut !== activeShortcut || !hotkeyMonitor) {
    stopNativeMonitor();
    startNativeMonitor(settings.shortcut);
  }
  const flowBarDockChanged = settings.flowBarDock !== activeFlowBarDock;
  activeFlowBarDock = settings.flowBarDock;
  const showFlowBarChanged = settings.showFlowBar !== activeShowFlowBar;
  activeShowFlowBar = settings.showFlowBar;
  if (
    (flowBarDockChanged || showFlowBarChanged) &&
    dictationWindow &&
    !dictationWindow.isDestroyed()
  ) {
    if (dockSnapTimer) clearTimeout(dockSnapTimer);
    dockSnapTimer = null;
    positionWindow(dictationWindow);
    broadcastFlowBarDock();
    if (currentDesktopDictationState === "idle") {
      if (activeShowFlowBar && rendererReady) dictationWindow.showInactive();
      else dictationWindow.hide();
    }
  }
  commandModeEnabled = settings.commandModeEnabled;
  const languageChanged = settings.language !== activeLanguage;
  activeLanguage = settings.language;
  const nextMicrophonePriority = [
    ...new Set(settings.microphonePriority.map((microphone) => microphone.deviceId)),
  ];
  const microphonesChanged =
    nextMicrophonePriority.length !== activeMicrophonePriority.length ||
    nextMicrophonePriority.some((deviceId, index) => deviceId !== activeMicrophonePriority[index]);
  activeMicrophonePriority = nextMicrophonePriority;
  if (commandModeEnabled) startCommandMonitor();
  else stopCommandMonitor();
  registerTransformShortcuts(settings);
  void applyDesktopDictationHistoryRetention(settings.historyRetention).catch((error) => {
    console.warn("[dictation] could not apply transcript-history retention", error);
  });
  if (languageChanged) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("dictation:languageChanged", {
          language: activeLanguage,
          label: DICTATION_LANGUAGE_LABELS[activeLanguage],
        });
      }
    }
    languageChangedListener?.();
  }
  if (microphonesChanged) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("dictation:microphonesChanged", {
          microphonePriority: activeMicrophonePriority,
        });
      }
    }
  }
}

export function getDesktopDictationLanguage(): DictationLanguage {
  return activeLanguage;
}

export function setDesktopDictationLanguageChangedListener(listener: (() => void) | null): void {
  languageChangedListener = listener;
}

export function controlDesktopDictationDock(
  action: "start" | "stop" | "cancel",
): { accepted: boolean; active: boolean; error?: string } {
  if (action === "start") {
    if (
      currentDesktopDictationState === "listening" ||
      currentDesktopDictationState === "transcribing" ||
      activeTransformPromise
    ) {
      return {
        accepted: false,
        active: currentDesktopDictationState === "listening",
        error: "Dictation is already active.",
      };
    }
    gestureController.reset();
    // The controller owns the lock so the configured hands-free shortcut can
    // stop a session that began by clicking the dock.
    gestureController.handle("hands-free-toggle");
    return { accepted: true, active: true };
  }

  if (action === "cancel") {
    if (
      currentDesktopDictationState !== "listening" &&
      currentDesktopDictationState !== "transcribing"
    ) {
      return { accepted: false, active: false, error: "No dictation is active." };
    }
    gestureController.reset();
    sendShortcut("cancel");
    return { accepted: true, active: false };
  }

  if (currentDesktopDictationState !== "listening") {
    return { accepted: false, active: false, error: "No recording is active." };
  }
  gestureController.reset();
  sendShortcut("hands-free-stop");
  return { accepted: true, active: false };
}

/** Menu-bar quick switch. The next capture receives this value at key-down. */
export async function setDesktopDictationLanguage(
  language: DictationLanguage,
): Promise<DictationSettings> {
  const next = await setTranscriptionConfig({ dictation: { language } });
  applyDesktopDictationSettings(next.dictation);
  return next.dictation;
}

function registerFallbackShortcut(): void {
  if (globalShortcut.isRegistered(FALLBACK_ACCELERATOR)) return;
  const registered = globalShortcut.register(FALLBACK_ACCELERATOR, () => {
    const now = Date.now();
    if (now - fallbackLastAt < 350) return;
    fallbackLastAt = now;
    fallbackActive = !fallbackActive;
    if (fallbackActive) {
      sendShortcut("pressed");
      sendShortcut("hands-free-locked");
    } else {
      sendShortcut("hands-free-stop");
    }
  });
  if (!registered && !monitorError) {
    monitorError = "The fallback desktop dictation shortcut is already in use.";
  }
}

function syncCancelShortcut(listening: boolean): void {
  if (listening) {
    if (globalShortcut.isRegistered(CANCEL_ACCELERATOR)) return;
    const registered = globalShortcut.register(CANCEL_ACCELERATOR, () => {
      gestureController.reset();
      sendShortcut("cancel");
    });
    if (!registered) console.warn("[dictation] cancel shortcut is already in use");
    return;
  }
  globalShortcut.unregister(CANCEL_ACCELERATOR);
  unregisterTransformShortcuts();
}

function registerRecoveryShortcuts(): void {
  if (!globalShortcut.isRegistered(PASTE_LAST_ACCELERATOR)) {
    const registered = globalShortcut.register(PASTE_LAST_ACCELERATOR, () => {
      void pasteLastDesktopDictation().then((result) => {
        updateDesktopDictationState(
          result.success ? "success" : "error",
          result.success ? "Pasted last transcript" : result.error,
        );
      });
    });
    if (!registered) console.warn("[dictation] paste-last shortcut is already in use");
  }
  if (!globalShortcut.isRegistered(COPY_LAST_ACCELERATOR)) {
    const registered = globalShortcut.register(COPY_LAST_ACCELERATOR, () => {
      void copyLastDesktopDictation().then((result) => {
        updateDesktopDictationState(
          result.success ? "success" : "error",
          result.success ? "Copied last transcript" : result.error,
        );
      });
    });
    if (!registered) console.warn("[dictation] copy-last shortcut is already in use");
  }
  if (!globalShortcut.isRegistered(RETRY_FAILED_ACCELERATOR)) {
    const registered = globalShortcut.register(RETRY_FAILED_ACCELERATOR, () => {
      sendShortcut("retry");
    });
    if (!registered) console.warn("[dictation] retry-failed shortcut is already in use");
  }
}

export function initDesktopDictation(): void {
  if (process.platform !== "darwin") return;
  ensureWindow();
  startNativeMonitor();
  startCommandMonitor();
  registerFallbackShortcut();
  registerRecoveryShortcuts();
  void getTranscriptionConfig()
    .then((config) => applyDesktopDictationSettings(config.dictation))
    .catch(() => {});
  void warmFastDictationEngine().catch((error) => {
    console.warn("[dictation] fast engine warmup failed; Whisper remains available", error);
  });
}

export function destroyDesktopDictation(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (dockSnapTimer) clearTimeout(dockSnapTimer);
  dockSnapTimer = null;
  globalShortcut.unregister(FALLBACK_ACCELERATOR);
  globalShortcut.unregister(PASTE_LAST_ACCELERATOR);
  globalShortcut.unregister(COPY_LAST_ACCELERATOR);
  globalShortcut.unregister(RETRY_FAILED_ACCELERATOR);
  globalShortcut.unregister(CANCEL_ACCELERATOR);
  gestureController.reset();
  stopNativeMonitor();
  stopCommandMonitor();
  if (dictationWindow && !dictationWindow.isDestroyed()) dictationWindow.destroy();
  dictationWindow = null;
  rendererReady = false;
  pendingPhases.length = 0;
  preparedContext = null;
  preparedCommandContext = null;
  activeTransformPromise = null;
  transformsEnabled = false;
  transformShortcutError = undefined;
  currentDesktopDictationState = "idle";
  activeShowFlowBar = true;
  stopFastDictationEngine();
}

export function desktopDictationStatus(): {
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
} {
  return {
    available: process.platform === "darwin" && fs.existsSync(audiocapBinaryPath()),
    monitorReady,
    commandModeReady: commandMonitorReady,
    commandModeEnabled,
    transformsEnabled,
    transformShortcutsReady:
      transformsEnabled && registeredTransformAccelerators.size > 0 && !transformShortcutError,
    accessibilityTrusted:
      process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(false),
    shortcut: `Hold ${shortcutLabel()}`,
    commandShortcut: COMMAND_SHORTCUT_LABEL,
    ...(transformShortcutError ? { transformShortcutError } : {}),
    ...(monitorError || commandMonitorError ? { error: monitorError ?? commandMonitorError } : {}),
  };
}

export function requestDictationAccessibility(): boolean {
  return process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(true);
}

export async function openInputMonitoringSettings(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  await shell.openExternal(INPUT_MONITORING_URL);
  return true;
}

export function updateDesktopDictationState(state: DesktopDictationState, message?: string): void {
  currentDesktopDictationState = state;
  const win = ensureWindow();
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  win.webContents.send("dictation:state", { state, message, dock: activeFlowBarDock });
  syncCancelShortcut(state === "listening");

  if (state === "idle") {
    fallbackActive = false;
    positionWindow(win);
    if (activeShowFlowBar && rendererReady) win.showInactive();
    else win.hide();
    return;
  }

  positionWindow(win);
  win.showInactive();
  if (state === "success" || state === "error") {
    hideTimer = setTimeout(
      () => {
        hideTimer = null;
        if (!win.isDestroyed()) updateDesktopDictationState("idle");
      },
      state === "success" ? 1200 : 4500,
    );
  }
}

function clipboardSnapshot(): Electron.Data {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    ...(image.isEmpty() ? {} : { image }),
  };
}

async function pasteClipboardText(
  text: string,
  previous: Electron.Data,
  pressEnter = false,
): Promise<{ success: boolean; error?: string }> {
  clipboard.writeText(text);
  if (process.platform !== "darwin") {
    return { success: false, error: "Desktop dictation is currently available on macOS." };
  }
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    return {
      success: false,
      error: "Transcript copied. Enable Accessibility, or click a text field and press Command+V.",
    };
  }

  try {
    await execFileAsync(audiocapBinaryPath(), ["paste", ...(pressEnter ? ["--enter"] : [])]);
    await new Promise((resolve) => setTimeout(resolve, 350));
    clipboard.write(previous);
    return { success: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: /assistive|not authorized|1002/i.test(detail)
        ? "Transcript copied. Enable Accessibility, or click a text field and press Command+V."
        : "Transcript copied. Click a text field and press Command+V, or use Control+Command+V to paste it again.",
    };
  }
}

export async function getDesktopDictationRecovery(): Promise<{
  available: boolean;
  preview?: string;
  createdAt?: string;
  audioAvailable: boolean;
  audioCreatedAt?: string;
  audioDurationMs?: number;
  audioErrorCode?: string;
}> {
  const [text, audio] = await Promise.all([recoveryStore.read(), audioRecoveryStore.summary()]);
  return {
    ...dictationRecoveryPreview(text),
    audioAvailable: audio.available,
    ...(audio.createdAt ? { audioCreatedAt: audio.createdAt } : {}),
    ...(audio.durationMs !== undefined ? { audioDurationMs: audio.durationMs } : {}),
    ...(audio.errorCode ? { audioErrorCode: audio.errorCode } : {}),
  };
}

/** Consume the context captured at Command Mode key-down, before model latency. */
export async function consumeDesktopCommandContext(): Promise<DesktopTextContext | null> {
  const pending = preparedCommandContext;
  preparedCommandContext = null;
  return pending ?? captureDesktopContext(audiocapBinaryPath(), true);
}

/**
 * Replace the exact selection Command Mode started from. If focus or selection
 * changed while the model was working, keep the result on the clipboard instead
 * of overwriting unrelated text.
 */
export async function pasteDesktopCommandResult(
  rawText: string,
  expected: DesktopTextContext,
): Promise<{ success: boolean; error?: string; copied?: boolean }> {
  const text = rawText.trim();
  if (!text) return { success: false, error: "The command did not produce any text." };
  if (expected.sensitive) {
    return { success: false, error: "Command Mode is unavailable in password fields." };
  }
  if (expected.selectedTextLength > expected.selectedText.length) {
    return {
      success: false,
      error: "The selection is too large for Command Mode. Select a smaller passage.",
    };
  }

  const current = await captureDesktopContext(audiocapBinaryPath(), true);
  const targetChanged = !desktopCommandTargetUnchanged(expected, current);
  await recoveryStore.save(text).catch((error) => {
    console.warn("[dictation] could not save Command Mode result", error);
  });
  if (targetChanged) {
    clipboard.writeText(text);
    return {
      success: false,
      copied: true,
      error: "The selection changed while the command was running. Result copied to clipboard.",
    };
  }

  return pasteClipboardText(text, clipboardSnapshot());
}

export async function copyLastDesktopDictation(): Promise<{
  success: boolean;
  error?: string;
}> {
  const recovered = await recoveryStore.read();
  if (!recovered) return { success: false, error: "No transcript is available yet." };
  clipboard.writeText(recovered.text);
  return { success: true };
}

export async function pasteLastDesktopDictation(): Promise<{
  success: boolean;
  error?: string;
}> {
  const recovered = await recoveryStore.read();
  if (!recovered) return { success: false, error: "No transcript is available yet." };
  return pasteClipboardText(recovered.text, clipboardSnapshot());
}

export async function pasteDesktopDictation(
  rawText: string,
  settings?: DictationSettings,
  metadata: DesktopDictationCommitMetadata = {},
): Promise<{ success: boolean; error?: string }> {
  // Read context before touching the clipboard. The target app remains focused,
  // and the native helper bounds nearby text and excludes password-like fields.
  const contextPromise = preparedContext;
  preparedContext = null;
  const context = settings
    ? await (contextPromise ?? captureDesktopContext(audiocapBinaryPath(), settings.contextEnabled))
    : null;
  if (context?.sensitive) {
    return { success: false, error: "Dictation is unavailable in password fields." };
  }
  const { text, pressEnter, changes } = polishDictation(rawText, {
    settings,
    context,
    language: metadata.language,
  });
  if (!text && !pressEnter) return { success: false, error: "No speech was captured." };
  if (text) {
    await recoveryStore.save(text).catch((error) => {
      console.warn("[dictation] could not save last transcript", error);
    });
  }
  const previous = text ? clipboardSnapshot() : null;
  try {
    const result = text
      ? await pasteClipboardText(text, previous!, pressEnter)
      : await execFileAsync(audiocapBinaryPath(), ["enter"]).then(() => ({ success: true }));
    if (changes.length) console.log("[dictation] polished transcript", { changes });
    if (text && settings) {
      const historyInput: DictationHistoryInput = {
        text,
        rawText,
        polishChanges: changes,
        status: "success",
        delivery: result.success ? "pasted" : "copied",
        appName: context?.appName,
        bundleIdentifier: context?.bundleIdentifier,
        engine: metadata.engine,
        language: metadata.language,
        audioDurationMs: metadata.audioDurationMs,
        transcriptionDurationMs: metadata.transcriptionDurationMs,
      };
      try {
        const entry = metadata.historyId
          ? await historyStore.complete(metadata.historyId, historyInput, settings.historyRetention)
          : await historyStore.add(historyInput, settings.historyRetention);
        if (entry) notifyDesktopDictationHistoryChanged();
      } catch (error) {
        console.warn("[dictation] could not save transcript history", error);
      }
    }
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: /assistive|not authorized|1002/i.test(detail)
        ? "Enable Oppulence in System Settings > Privacy & Security > Accessibility, then try again."
        : "The transcript was ready, but Oppulence could not paste into the focused app.",
    };
  }
}
