import {
  ipcMain,
  BrowserWindow,
  shell,
  dialog,
  systemPreferences,
  desktopCapturer,
  app,
  MessageChannelMain,
} from "electron";
import { ipc } from "@x/shared";
import { markSecondaryWindow } from "./main-window.js";
import path from "node:path";
import os from "node:os";
import {
  connectProvider,
  connectConnector,
  connectSlackWorkspace,
  disconnectProvider,
  listProviders,
} from "./oauth-handler.js";
import { watcher as watcherCore, workspace } from "@x/core";
import { WorkDir } from "@x/core/dist/config/config.js";
import {
  getNotificationsConfig,
  setNotificationsConfig,
} from "@x/core/dist/config/notifications.js";
import { workspace as workspaceShared } from "@x/shared";
import * as mcpCore from "@x/core/dist/mcp/mcp.js";
import * as runsCore from "@x/core/dist/runs/runs.js";
import { bus } from "@x/core/dist/runs/bus.js";
import { serviceBus } from "@x/core/dist/services/service_bus.js";
import type { FSWatcher } from "chokidar";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import z from "zod";

const execAsync = promisify(exec);
import { RunEvent } from "@x/shared/dist/runs.js";
import { ServiceEvent } from "@x/shared/dist/service-events.js";
import container from "@x/core/dist/di/container.js";
import { listOnboardingModels } from "@x/core/dist/models/models-dev.js";
import { testModelConnection } from "@x/core/dist/models/models.js";
import {
  getDefaultModelAndProvider,
  getMeetingNotesModel,
  resolveProviderConfig,
} from "@x/core/dist/models/defaults.js";
import { isSignedIn } from "@x/core/dist/account/account.js";
import { listGatewayModels } from "@x/core/dist/models/gateway.js";
import type { IModelConfigRepo } from "@x/core/dist/models/repo.js";
import type { IOAuthRepo } from "@x/core/dist/auth/repo.js";
import { IGranolaConfigRepo } from "@x/core/dist/knowledge/granola/repo.js";
import { ICodeModeConfigRepo } from "@x/core/dist/code-mode/repo.js";
import { CodePermissionRegistry } from "@x/core/dist/code-mode/acp/permission-registry.js";
import { checkCodeModeAgentStatus } from "@x/core/dist/code-mode/status.js";
import { invalidateCopilotInstructionsCache } from "@x/core/dist/application/assistant/instructions.js";
import { triggerSync as triggerGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { ISlackConfigRepo } from "@x/core/dist/slack/repo.js";
import {
  isOnboardingComplete,
  markOnboardingComplete,
} from "@x/core/dist/config/note_creation_config.js";
import { consumePendingDeepLink } from "./deeplink.js";
import { checkForUpdates, getUpdateStatus, installUpdate } from "./update-manager.js";
import { getPrivacyConfig, setPrivacyConfig } from "@x/core/dist/config/privacy.js";
import { IAgentScheduleRepo } from "@x/core/dist/agent-schedule/repo.js";
import { IAgentScheduleStateRepo } from "@x/core/dist/agent-schedule/state-repo.js";
import {
  triggerRun as triggerAgentScheduleRun,
  calculateNextRunAt as calculateAgentNextRunAt,
} from "@x/core/dist/agent-schedule/runner.js";
import { loadAgent } from "@x/core/dist/agents/runtime.js";
import { search } from "@x/core/dist/search/search.js";
import {
  memorySearch,
  relatedNotes,
  memoryStatus,
  rebuildMemoryIndex,
} from "@x/core/dist/memory/index.js";
import { memoryBus } from "@x/core/dist/memory/bus.js";
import { versionHistory, voice } from "@x/core";
import {
  WhisperService,
  configureWhisperBinary,
  binaryAvailable,
  pcmStats,
  probeCapability,
  codeOf as whisperCodeOf,
  type StreamPort,
} from "@x/core/dist/voice/whisper/index.js";
import { parseVoiceCommand } from "@x/core/dist/voice/commands/parser.js";
import { transformDictationCommand } from "@x/core/dist/voice/command-mode.js";
import {
  executeVoiceCommand,
  type VoiceEmailActions,
} from "@x/core/dist/voice/commands/executor.js";
import { buildTranscriptionRouting, providerDataLocation } from "@x/core/dist/voice/routing.js";
import { WhisperUtilityRunner } from "./whisper-utility-client.js";
import type {
  DictationLanguage,
  TranscriptionConfig,
  TranscriptionDataLocation,
  TranscriptionProvider,
} from "@x/shared/dist/transcription.js";
import {
  classifySchedule,
  processSolomonInstruction,
} from "@x/core/dist/knowledge/inline_tasks.js";
import {
  createBillingCheckoutSession,
  getBillingInfo,
  getBillingPortalUrl,
  syncBilling,
} from "@x/core/dist/billing/billing.js";
import { submitFeedback } from "@x/core/dist/feedback/feedback.js";
import { AuthUnavailableError } from "@x/core/dist/auth/refresh-errors.js";
import {
  deleteConnectorViaBackend,
  listConnectorsViaBackend,
  saveConnectorAPIKeyViaBackend,
} from "@x/core/dist/connectors/connectors-backend.js";
import {
  deleteSlackWorkspaceViaBackend,
  listSlackWorkspacesViaBackend,
  postSlackThreadReplyViaBackend,
} from "@x/core/dist/auth/slack-backend-oauth.js";
import { summarizeMeeting } from "@x/core/dist/knowledge/summarize_meeting.js";
import { getAccessToken } from "@x/core/dist/auth/tokens.js";
import { getSolomonConfig } from "@x/core/dist/config/solomon.js";
import { runLiveNoteAgent } from "@x/core/dist/knowledge/live-note/runner.js";
import {
  listImportantThreads,
  listEverythingElseThreads,
  saveMessageBodyHeight,
  triggerSync as triggerGmailSync,
  sendThreadReply,
  archiveThread,
  trashThread,
  markThreadRead,
  getAccountEmail,
  getConnectionStatus as getGmailConnectionStatus,
} from "@x/core/dist/knowledge/sync_gmail.js";
import { liveNoteBus } from "@x/core/dist/knowledge/live-note/bus.js";
import { getInstallationId } from "@x/core/dist/analytics/installation.js";
import { API_URL } from "@x/core/dist/config/env.js";
import {
  approveRelationshipRecommendation,
  acknowledgeMissionControl,
  correctConversationReview,
  decideConversationReview,
  correctRelationship,
  createRelationshipAction,
  createRelationship,
  getRelationship,
  getRelationshipGraph,
  getRelationshipChanges,
  getRelationshipEvidence,
  getRelationshipSourceInventory,
  getRelationshipSources,
  getRelationshipBetaDiagnostics,
  reportRelationshipSourceAuthorization,
  getRelationshipTimeline,
  getRelationshipActionAudit,
  getRelationshipActionSourceBody,
  recordRelationshipActionOutcome,
  ingestRelationshipObservations,
  listRelationships,
  listIdentityCandidates,
  listRelationshipAttention,
  decideRelationshipAttention,
  editRelationshipAction,
  evaluateRelationshipAction,
  executeRelationshipAction,
  snoozeRelationshipAction,
  dismissRelationshipAction,
  decideIdentityCandidate,
  deletePerson,
  resyncRelationshipSource,
  disconnectRelationshipSource,
  rejectRelationshipRecommendation,
  resolveRelationshipContradiction,
  runCommitmentRecovery,
  appendCommitmentTransition,
  createMutualActionPlan,
  reviseMutualActionPlan,
  approveMutualActionPlan,
  shareMutualActionPlan,
  requestConversationDeletion,
  retractRelationshipAssertion,
  searchRelationships,
} from "@x/core/dist/relationships/client.js";
import {
  fetchLiveNote,
  setLiveNote,
  setLiveNoteActive,
  deleteLiveNote,
  listLiveNotes,
} from "@x/core/dist/knowledge/live-note/fileops.js";
import { runBackgroundTask } from "@x/core/dist/background-tasks/runner.js";
import {
  cancelCloudRun,
  getArtifactSyncState,
  getCloudRun,
  getCloudScheduleState,
  getCloudRunStatus,
  listAllCloudRuns,
  listCloudRunEvents,
  listCloudRuns,
  rerunCloudRun,
  retryCloudRun,
  signalCloudRun,
  syncArtifactFromCloud,
  triggerCloudRun,
} from "@x/core/dist/background-tasks/cloud-sync.js";
import { backgroundTaskBus } from "@x/core/dist/background-tasks/bus.js";
import {
  fetchTask,
  patchTask,
  createTask,
  deleteTask,
  listTasks,
  readRunIds as readTaskRunIds,
} from "@x/core/dist/background-tasks/fileops.js";
import { browserIpcHandlers } from "./browser/ipc.js";
import { mailboxIpcHandlers } from "./ipc/mailbox.js";
import { createMeetingIpcHandlers } from "./ipc/meetings.js";
import { nativeCaptureAvailable, resolveCaptureEngine } from "./meeting-capture.js";
import { transcribeFastDictation } from "./parakeet-dictation-runner.js";
import { getMeetingController } from "./meeting-controller.js";
import { initMeetingTray } from "./tray.js";
import { ensureAgentSlackAvailable } from "./agent-slack.js";
import {
  applyDesktopDictationSettings,
  consumeDesktopCommandContext,
  copyDesktopDictationHistoryEntry,
  copyLastDesktopDictation,
  clearDesktopDictationHistory,
  completeFailedDesktopDictationHistory,
  controlDesktopDictationDock,
  deleteDesktopDictationHistoryEntry,
  desktopDictationAudioRecoveryStore,
  desktopDictationStatus,
  getDesktopDictationHistory,
  getDesktopDictationRecovery,
  notifyDesktopDictationHistoryChanged,
  openInputMonitoringSettings,
  pasteDesktopDictation,
  pasteDesktopCommandResult,
  pasteLastDesktopDictation,
  requestDictationAccessibility,
  recordFailedDesktopDictation,
  toggleDesktopDictationHistoryFormatting,
  updateDesktopDictationState,
} from "./desktop-dictation.js";

/**
 * Convert markdown to a styled HTML document for PDF/DOCX export.
 */
function markdownToHtml(markdown: string, title: string): string {
  // Simple markdown to HTML conversion for export purposes
  let html = markdown
    // Resolve wiki links [[Folder/Note Name]] or [[Folder/Note Name|Display]] to plain text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, _path, display) => display.trim())
    .replace(/\[\[([^\]]+)\]\]/g, (_match, linkPath: string) => {
      // Use the last segment (filename) as the display name
      const segments = linkPath.trim().split("/");
      return segments[segments.length - 1];
    })
    // Escape HTML entities (but preserve markdown syntax)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headings (must come before other processing)
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs: wrap remaining lines that aren't already wrapped in HTML tags
  html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, "<p>$1</p>");

  // Clean up consecutive list items into lists
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; font-size: 14px; }
  h1 { font-size: 1.8em; margin-top: 1em; } h2 { font-size: 1.4em; margin-top: 1em; } h3 { font-size: 1.2em; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  blockquote { border-left: 3px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
  ul { padding-left: 1.5em; }
  a { color: #0066cc; }
</style></head><body>${html}</body></html>`;
}

function resolveShellPath(filePath: string): string {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return workspace.resolveWorkspacePath(filePath);
}

type InvokeChannels = ipc.InvokeChannels;
type IPCChannels = ipc.IPCChannels;

/**
 * Type-safe handler function for invoke channels
 */
type InvokeHandler<K extends InvokeChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]["req"],
) => IPCChannels[K]["res"] | Promise<IPCChannels[K]["res"]>;

/**
 * Type-safe handler registration map
 * Ensures all invoke channels have handlers
 */
type InvokeHandlers = {
  [K in InvokeChannels]: InvokeHandler<K>;
};

/**
 * Register all IPC handlers with type safety and runtime validation
 *
 * This function ensures:
 * 1. All invoke channels have handlers (exhaustiveness checking)
 * 2. Handler signatures match channel definitions
 * 3. Request/response payloads are validated at runtime
 */
export function registerIpcHandlers(handlers: InvokeHandlers) {
  // Register each handler with runtime validation
  for (const [channel, handler] of Object.entries(handlers) as [
    InvokeChannels,
    InvokeHandler<InvokeChannels>,
  ][]) {
    ipcMain.handle(channel, async (event, rawArgs) => {
      // Validate request payload
      const args = ipc.validateRequest(channel, rawArgs);

      // Call handler
      const result = await handler(event, args);

      // Validate response payload
      return ipc.validateResponse(channel, result);
    });
  }
}

// ============================================================================
// Electron-Specific Utilities
// ============================================================================

/**
 * Get application versions (Electron-specific)
 */
function getVersions(): {
  chrome: string;
  node: string;
  electron: string;
  app: string;
} {
  return {
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron,
    // The version a user is actually asking about when they open Updates.
    app: app.getVersion(),
  };
}

// ============================================================================
// Workspace Watcher (with debouncing and lifecycle management)
// ============================================================================

let watcher: FSWatcher | null = null;
const changeQueue = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Emit knowledge commit event to all renderer windows
 */
function emitKnowledgeCommitEvent(): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("knowledge:didCommit", {});
    }
  }
}

/**
 * Emit workspace change event to all renderer windows
 */
function emitWorkspaceChangeEvent(
  event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>,
): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("workspace:didChange", event);
    }
  }
}

/**
 * Process queued changes and emit events (debounced)
 */
function processChangeQueue(): void {
  if (changeQueue.size === 0) {
    return;
  }

  const paths = Array.from(changeQueue);
  changeQueue.clear();

  if (paths.length === 1) {
    // For single path, try to determine kind from file stats
    const relPath = paths[0]!;
    try {
      const absPath = workspace.resolveWorkspacePath(relPath);
      fs.lstat(absPath)
        .then((stats) => {
          const kind = stats.isDirectory() ? "dir" : "file";
          emitWorkspaceChangeEvent({ type: "changed", path: relPath, kind });
        })
        .catch(() => {
          // File no longer exists (edge case), emit without kind
          emitWorkspaceChangeEvent({ type: "changed", path: relPath });
        });
    } catch {
      // Invalid path, ignore
    }
  } else {
    // Emit bulkChanged for multiple paths
    emitWorkspaceChangeEvent({ type: "bulkChanged", paths });
  }
}

/**
 * Queue a path change for debounced emission
 */
function queueChange(relPath: string): void {
  changeQueue.add(relPath);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    processChangeQueue();
    debounceTimer = null;
  }, 150); // 150ms debounce
}

/**
 * Handle workspace change event from core watcher
 */
function handleWorkspaceChange(event: z.infer<typeof workspaceShared.WorkspaceChangeEvent>): void {
  // Debounce 'changed' events, emit others immediately
  if (event.type === "changed" && event.path) {
    queueChange(event.path);
  } else {
    emitWorkspaceChangeEvent(event);
  }
}

/**
 * Start workspace watcher
 * Watches the configured workspace root recursively and emits change events to renderer
 *
 * This should be called once when the app starts (from main.ts).
 * The watcher runs as a main-process service and catches ALL filesystem changes
 * (both from IPC handlers and external changes like terminal/git).
 *
 * Safe to call multiple times - guards against duplicate watchers.
 */
export async function startWorkspaceWatcher(): Promise<void> {
  if (watcher) {
    // Watcher already running - safe to ignore subsequent calls
    return;
  }

  watcher = await watcherCore.createWorkspaceWatcher(handleWorkspaceChange);
}

/**
 * Stop workspace watcher
 */
export function stopWorkspaceWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  changeQueue.clear();
}

function emitRunEvent(event: z.infer<typeof RunEvent>): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("runs:events", event);
    }
  }
}

function emitServiceEvent(event: z.infer<typeof ServiceEvent>): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("services:events", event);
    }
  }
}

export function emitOAuthEvent(event: {
  provider: string;
  success: boolean;
  error?: string;
  userId?: string;
  sourceAccountId?: string;
  grantedScopes?: string[];
}): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("oauth:didConnect", event);
    }
  }
}

let runsWatcher: (() => void) | null = null;
export async function startRunsWatcher(): Promise<void> {
  if (runsWatcher) {
    return;
  }
  runsWatcher = await bus.subscribe("*", async (event) => {
    emitRunEvent(event);
  });
}

let servicesWatcher: (() => void) | null = null;
export async function startServicesWatcher(): Promise<void> {
  if (servicesWatcher) {
    return;
  }
  servicesWatcher = await serviceBus.subscribe(async (event) => {
    emitServiceEvent(event);
  });
}

let liveNoteAgentWatcher: (() => void) | null = null;
export function startLiveNoteAgentWatcher(): void {
  if (liveNoteAgentWatcher) return;
  liveNoteAgentWatcher = liveNoteBus.subscribe((event) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send("live-note-agent:events", event);
      }
    }
  });
}

let backgroundTaskAgentWatcher: (() => void) | null = null;
export function startBackgroundTaskAgentWatcher(): void {
  if (backgroundTaskAgentWatcher) return;
  backgroundTaskAgentWatcher = backgroundTaskBus.subscribe((event) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send("bg-task-agent:events", event);
      }
    }
  });
}

let memoryWatcher: (() => void) | null = null;
export function startMemoryWatcher(): void {
  if (memoryWatcher) return;
  memoryWatcher = memoryBus.subscribe((event) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send("memory:indexProgress", event);
      }
    }
  });
}

export function stopRunsWatcher(): void {
  if (runsWatcher) {
    runsWatcher();
    runsWatcher = null;
  }
}

export function stopServicesWatcher(): void {
  if (servicesWatcher) {
    servicesWatcher();
    servicesWatcher = null;
  }
}

// ============================================================================
// Handler Implementations
// ============================================================================

/**
 * Register all IPC handlers
 * Add new handlers here as you add channels to IPCChannels
 */
async function getSolomonAccountState() {
  const signedIn = await isSignedIn();
  if (!signedIn) {
    return {
      signedIn: false,
      accessToken: null,
      config: null,
      authReason: "not_signed_in" as const,
    };
  }

  const config = await getSolomonConfig();

  try {
    const accessToken = await getAccessToken();
    return { signedIn: true, accessToken, config, authReason: null };
  } catch (error) {
    return {
      signedIn: true,
      accessToken: null,
      config,
      authReason: error instanceof AuthUnavailableError ? error.reason : null,
    };
  }
}

// ============================================================================
// Local on-device transcription (whisper.cpp) — RFC 009
// ============================================================================

let whisperService: WhisperService | null = null;
let whisperUtilityRunner: WhisperUtilityRunner | null = null;

/** Absolute path to the per-arch `whisper-cli` (packaged extraResource, or dev vendor). */
function whisperBinaryPath(): string {
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  if (process.env.ROWBOAT_WHISPER_BIN) return process.env.ROWBOAT_WHISPER_BIN;
  if (process.env.ROWBOAT_WHISPER_DIR) return path.join(process.env.ROWBOAT_WHISPER_DIR, exe);
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "whisper", exe); // extraResource → Resources/whisper/
  }
  // Dev: apps/x/vendor/whisper/<platform>-<arch>/whisper-cli (absent until built → cloud fallback).
  return path.join(
    app.getAppPath(),
    "..",
    "..",
    "vendor",
    "whisper",
    `${process.platform}-${process.arch}`,
    exe,
  );
}

/** Lazily construct the singleton WhisperService and wire its progress events. */
function getWhisper(): WhisperService {
  if (whisperService) return whisperService;
  configureWhisperBinary(whisperBinaryPath());
  whisperUtilityRunner ??= new WhisperUtilityRunner(whisperBinaryPath);
  whisperService = new WhisperService(
    WorkDir,
    (progress) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send("whisper:modelProgress", progress);
        }
      }
    },
    {},
    {
      read: voice.readWhisperBenchmarks,
      write: voice.writeWhisperBenchmark,
    },
    whisperUtilityRunner.transcribePcm,
  );
  return whisperService;
}

async function transcribeDictationPcm(
  pcm16: Int16Array,
  cfg: TranscriptionConfig,
  requestedLanguage?: DictationLanguage,
) {
  const audioMs = (pcm16.length / 16_000) * 1_000;
  const language = requestedLanguage ?? cfg.dictation.language;

  // Parakeet is the low-latency primary. Whisper is also the automatic retry
  // engine: a user sees a retry prompt only if both independent local paths fail.
  try {
    console.log("[dictation] parakeet transcribe start", { audioMs, language });
    const result = await transcribeFastDictation(pcm16, language);
    if (!result.text.trim()) throw new Error("Parakeet returned an empty transcript");
    console.log("[dictation] parakeet transcribe success", {
      textLength: result.text.length,
      durationMs: Math.round(result.durationMs),
      rtf: Number(result.rtf.toFixed(1)),
    });
    return {
      success: true as const,
      text: result.text,
      segments: result.segments,
      rtf: result.rtf,
      durationMs: result.durationMs,
      engine: "parakeet" as const,
      language: result.language ?? language,
    };
  } catch (error) {
    console.warn("[dictation] fast engine failed; falling back to whisper", error);
  }

  try {
    let model = cfg.whisper.model;
    if (language !== "en" && model.includes(".en-")) {
      const multilingualModel = model.replace(".en-", "-");
      const models = await getWhisper().listModels();
      if (models.some((candidate) => candidate.id === multilingualModel && candidate.installed)) {
        model = multilingualModel;
      }
    }
    console.log("[dictation] whisper fallback start", { audioMs, model, lang: language });
    const result = await getWhisper().transcribe(pcm16, {
      channels: 1,
      model,
      lang: language,
    });
    if (!result.text.trim()) {
      return {
        success: false as const,
        code: "audio_invalid",
        message: "The local engines did not produce a transcript.",
      };
    }
    return {
      success: true as const,
      text: result.text,
      segments: result.segments,
      rtf: result.rtf,
      durationMs: result.durationMs,
      engine: "whisper" as const,
      language,
    };
  } catch (error) {
    console.error("[dictation] local transcription failed", error);
    return {
      success: false as const,
      code: whisperCodeOf(error),
      message: (error as Error)?.message,
    };
  }
}

/**
 * Bring up native meeting capture: a menu-bar item so a recording is visible and
 * stoppable with no window open, and a rescan for sessions that finished but were
 * never transcribed.
 *
 * Lives here so `getWhisper` stays private — the controller only needs the facade.
 * Skipped entirely when the sidecar can't run, in which case meetings record through
 * the renderer pipeline and there is nothing for a tray to control.
 */
export function initMeetingCapture(): void {
  const controller = getMeetingController({ whisper: getWhisper });
  if (!nativeCaptureAvailable()) {
    console.log("[meeting] native capture unavailable — using the in-app pipeline");
    // Renderer-only platforms still own the shared evidence outbox. Refreshing the
    // controller at launch retries consented items left by an offline prior session.
    void controller
      .refreshSettings()
      .catch((err) => console.error("[meeting] evidence retry failed:", err));
    return;
  }
  initMeetingTray(controller);
  void controller
    .refreshSettings()
    .then(() => controller.resumePending())
    .catch((err) => console.error("[meeting] resume failed:", err));
}

/** On-device transcription is viable only when the binary exists AND the device is capable (§13). */
async function localTranscriptionSupported(): Promise<boolean> {
  configureWhisperBinary(whisperBinaryPath());
  if (!binaryAvailable()) return false;
  try {
    return (await probeCapability()).supported;
  } catch {
    return false;
  }
}

type RemoteTranscriptionState = {
  voiceProvider?: TranscriptionProvider;
  meetingProvider?: TranscriptionProvider;
  meetingMinutesRemaining?: number | null;
};

function asProvider(value: unknown): TranscriptionProvider | undefined {
  return value === "whisper-local" ||
    value === "deepgram" ||
    value === "solomon" ||
    value === "none"
    ? value
    : undefined;
}

// Provider resolution runs on hot paths (mic warmup, every OAuth connect, meeting
// start), so cache the remote payload briefly and never let a slow endpoint stall
// resolution. Fleet defaults + quota change rarely; a 60s TTL is plenty.
const REMOTE_TRANSCRIPTION_TTL_MS = 60_000;
const REMOTE_TRANSCRIPTION_FETCH_TIMEOUT_MS = 4_000;
let remoteTranscriptionCache: { at: number; value: RemoteTranscriptionState | null } | null = null;

const unavailableEmailActions: VoiceEmailActions = {
  archiveByQuery: async () => {
    throw new Error("Voice email archive actions are wired in the email action adapter task.");
  },
  labelByQuery: async () => {
    throw new Error("Voice email label actions are wired in the email action adapter task.");
  },
  composeReply: async () => {
    throw new Error("Voice reply drafting is wired in the email action adapter task.");
  },
  createRule: async () => {
    throw new Error("Voice rule drafting is wired in the email action adapter task.");
  },
};

/**
 * Per-user quota + A/B-able fleet defaults from the authenticated endpoint (RFC 009
 * Appendix O.6). Signed-out / failure → null, so the resolver falls back to the user
 * override → hardcoded default. Cached with a short TTL and a hard fetch timeout.
 */
async function remoteTranscriptionState(): Promise<RemoteTranscriptionState | null> {
  if (!(await isSignedIn())) {
    remoteTranscriptionCache = null;
    return null;
  }
  const cached = remoteTranscriptionCache;
  if (cached && Date.now() - cached.at < REMOTE_TRANSCRIPTION_TTL_MS) return cached.value;

  let value: RemoteTranscriptionState | null = null;
  try {
    const token = await getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TRANSCRIPTION_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_URL}/v1/transcription/quota`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          meetingMinutesRemaining?: number;
          unlimited?: boolean;
          transcriptionDefaults?: { voiceProvider?: string; meetingProvider?: string };
        };
        value = {
          voiceProvider: asProvider(data.transcriptionDefaults?.voiceProvider),
          meetingProvider: asProvider(data.transcriptionDefaults?.meetingProvider),
          // Unlimited (paid) → null so the quota gate never trips.
          meetingMinutesRemaining: data.unlimited
            ? null
            : typeof data.meetingMinutesRemaining === "number"
              ? data.meetingMinutesRemaining
              : null,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    value = null; // network error / timeout → fall back, and brief-cache the null below
  }
  remoteTranscriptionCache = { at: Date.now(), value };
  return value;
}

async function resolveVoiceProviderMain(): Promise<TranscriptionProvider> {
  const cfg = await voice.readTranscriptionConfig();
  const [signedIn, remote, localSupported] = await Promise.all([
    isSignedIn(),
    remoteTranscriptionState(),
    localTranscriptionSupported(),
  ]);
  return voice.resolveVoiceProvider({
    userOverride: cfg?.voiceProvider,
    remoteDefault: remote?.voiceProvider,
    signedIn,
    localSupported,
    localOnly: cfg?.privacy.localOnly ?? false,
  });
}

async function resolveMeetingProviderMain(): Promise<{
  provider: TranscriptionProvider;
  reason: voice.ProviderReason;
}> {
  const cfg = await voice.readTranscriptionConfig();
  const [signedIn, remote, localSupported, voiceCfg] = await Promise.all([
    isSignedIn(),
    remoteTranscriptionState(),
    localTranscriptionSupported(),
    voice.getVoiceConfig(),
  ]);
  let hasSolomonWebsocket = false;
  if (signedIn) {
    try {
      const solomonConfig = await getSolomonConfig();
      hasSolomonWebsocket = !!solomonConfig.websocketApiUrl;
    } catch {
      hasSolomonWebsocket = false;
    }
  }
  return voice.resolveMeetingProvider({
    userOverride: cfg?.meetingProvider,
    remoteDefault: remote?.meetingProvider,
    signedIn,
    localSupported,
    hasOwnDeepgramKey: !!voiceCfg.deepgram,
    cloudAvailable: !!voiceCfg.deepgram || hasSolomonWebsocket,
    meetingMinutesRemaining: remote?.meetingMinutesRemaining ?? null,
    localOnly: cfg?.privacy.localOnly ?? false,
  });
}

/**
 * The effective data-flow receipt used by both Transcription and Privacy settings.
 *
 * This is intentionally assembled in main: only main can see all four inputs that
 * change the answer — account/provider tiering, the packaged native-capture helper,
 * persisted transcription settings, and the configured language-model endpoint.
 */
async function transcriptionRoutingMain() {
  const cfg = await voice.getTranscriptionConfig();
  const [effectiveVoiceProvider, effectiveMeeting, modelDefaults, meetingModel] = await Promise.all(
    [
      resolveVoiceProviderMain(),
      resolveMeetingProviderMain(),
      getDefaultModelAndProvider().catch(() => ({ provider: "unconfigured", model: "" })),
      getMeetingNotesModel().catch(() => ""),
    ],
  );

  let enrichmentLocation: TranscriptionDataLocation = "unknown";
  if (modelDefaults.provider !== "unconfigured") {
    try {
      const provider = await resolveProviderConfig(modelDefaults.provider);
      enrichmentLocation = providerDataLocation({
        flavor: provider.flavor,
        baseURL: provider.baseURL,
      });
    } catch {
      enrichmentLocation = "unknown";
    }
  }

  const captureEngine = resolveCaptureEngine(cfg.meetings.captureEngine);
  const nativeProcessing = captureEngine === "native" && cfg.meetings.transcribeOnStop;
  return buildTranscriptionRouting({
    localOnly: cfg.privacy.localOnly,
    configuredVoiceProvider: cfg.voiceProvider,
    effectiveVoiceProvider,
    configuredMeetingProvider: cfg.meetingProvider,
    effectiveRendererMeetingProvider: effectiveMeeting.provider,
    meetingProviderReason: effectiveMeeting.reason,
    captureEngine,
    nativeTranscriptionEngine: cfg.meetings.transcriptionEngine,
    enrichment: {
      provider: modelDefaults.provider,
      model: meetingModel || modelDefaults.model,
      location: enrichmentLocation,
      // Renderer meetings summarize on stop. Native meetings do so as part of the
      // post-stop queue, which can be disabled explicitly.
      summariesEnabled: captureEngine === "renderer" || nativeProcessing,
      commitmentsEnabled: nativeProcessing && cfg.meetings.extractCommitments !== false,
      liveQuestionsEnabled: captureEngine === "native" && cfg.meetings.liveTranscript === true,
    },
    relationshipEvidence: {
      // Read from the five live consent flags, not the deprecated
      // meetings.syncRelationshipEvidence, which no UI has written since the
      // migration — so the receipt reported "off" while email metadata shipped.
      enabled:
        cfg.relationships.meetingTranscripts ||
        cfg.relationships.meetingAttendance ||
        cfg.relationships.emailMetadata ||
        cfg.relationships.signatureEnrichment ||
        cfg.relationships.modelContactExtraction,
      location: providerDataLocation({
        flavor: "openai-compatible",
        baseURL: API_URL,
      }),
      destination: "Oppulence relationship state",
      sharing: {
        meetingTranscripts: cfg.relationships.meetingTranscripts,
        meetingAttendance: cfg.relationships.meetingAttendance,
        emailMetadata: cfg.relationships.emailMetadata,
        signatureEnrichment: cfg.relationships.signatureEnrichment,
        modelContactExtraction: cfg.relationships.modelContactExtraction,
      },
    },
  });
}

export function setupIpcHandlers() {
  // Forward knowledge commit events to renderer for panel refresh
  versionHistory.onCommit(() => emitKnowledgeCommitEvent());

  registerIpcHandlers({
    "app:getVersions": async () => {
      // args is null for this channel (no request payload)
      return getVersions();
    },
    "app:consumePendingDeepLink": async () => {
      return { url: consumePendingDeepLink() };
    },
    "privacy:getConfig": async () => getPrivacyConfig(),
    "privacy:setConfig": async (_event, args) => setPrivacyConfig(args),
    "app:getUpdateStatus": async () => getUpdateStatus(),
    "app:checkForUpdates": async () => checkForUpdates(),
    "app:installUpdate": async () => installUpdate(),
    "analytics:bootstrap": async () => {
      return {
        installationId: getInstallationId(),
        apiUrl: API_URL,
        appVersion: app.getVersion(),
      };
    },
    "relationships:list": async (_event, args) => listRelationships(args),
    "relationships:graph": async (_event, args) => getRelationshipGraph(args),
    "relationships:create": async (_event, args) => createRelationship(args),
    "relationships:search": async (_event, args) => searchRelationships(args.query),
    "relationships:get": async (_event, args) => getRelationship(args.id),
    "relationships:acknowledge": async (_event, args) =>
      acknowledgeMissionControl(args.id, args.stateVersion, args.stateHash),
    "relationships:timeline": async (_event, args) => getRelationshipTimeline(args.id, args.limit),
    "relationships:changes": async (_event, args) => getRelationshipChanges(args.id),
    "relationships:sources": async () => getRelationshipSources(),
    "relationships:sourceInventory": async () => getRelationshipSourceInventory(),
    "relationships:betaDiagnostics": async () => getRelationshipBetaDiagnostics(),
    "relationships:reportSourceAuthorization": async (_event, args) =>
      reportRelationshipSourceAuthorization(args.source, args),
    "relationships:resyncSource": async (_event, args) =>
      resyncRelationshipSource(args.source, args.sourceAccountId),
    "relationships:disconnectSource": async (_event, args) =>
      disconnectRelationshipSource(args.source, args.sourceAccountId),
    "relationships:deletePerson": async (_event, args) =>
      deletePerson(args.personId, { reason: args.reason, note: args.note }),
    "relationships:listIdentityCandidates": async (_event, args) =>
      listIdentityCandidates(args.status, args.relationshipId),
    "relationships:decideIdentityCandidate": async (_event, args) =>
      decideIdentityCandidate(args.candidateId, args),
    "relationships:listAttention": async (_event, args) => listRelationshipAttention(args.status),
    "relationships:decideAttention": async (_event, args) =>
      decideRelationshipAttention(args.attentionId, args),
    "relationships:editAction": async (_event, args) => editRelationshipAction(args.actionId, args),
    "relationships:createAction": async (_event, args) => createRelationshipAction(args),
    "relationships:evaluateAction": async (_event, args) =>
      evaluateRelationshipAction(args.actionId),
    "relationships:executeAction": async (_event, args) => executeRelationshipAction(args.actionId),
    "relationships:snoozeAction": async (_event, args) =>
      snoozeRelationshipAction(args.actionId, args.until),
    "relationships:dismissAction": async (_event, args) =>
      dismissRelationshipAction(args.actionId, args.reason),
    "relationships:actionAudit": async (_event, args) => getRelationshipActionAudit(args.actionId),
    "relationships:actionSourceBody": async (_event, args) =>
      getRelationshipActionSourceBody(args.actionId),
    "relationships:recordOutcome": async (_event, args) =>
      recordRelationshipActionOutcome(args.actionId, {
        kind: args.kind,
        source: "user",
        sourceEventId: args.sourceEventId,
        occurredAt: args.occurredAt,
      }),
    "relationships:ingestObservations": async (_event, args) =>
      ingestRelationshipObservations(args.observations),
    "relationships:evidence": async (_event, args) =>
      getRelationshipEvidence(args.relationshipId, args.evidenceId),
    "relationships:correct": async (_event, args) =>
      correctRelationship(args.id, {
        dimension: args.dimension,
        value: args.value,
        reason: args.reason,
      }),
    "relationships:retractAssertion": async (_event, args) =>
      retractRelationshipAssertion(args.relationshipId, args.assertionId, args.reason),
    "relationships:correctConversation": async (_event, args) =>
      correctConversationReview(args.id, {
        reviewItemId: args.reviewItemId,
        correctedValue: args.correctedValue,
        reason: args.reason,
      }),
    "relationships:decideConversation": async (_event, args) =>
      decideConversationReview(args.id, {
        reviewItemId: args.reviewItemId,
        kind: args.kind,
        correctedValue: args.correctedValue,
        reason: args.reason,
        deferUntil: args.deferUntil,
      }),
    "relationships:resolveContradiction": async (_event, args) =>
      resolveRelationshipContradiction(args.id, args.caseId, {
        selectedAssertionId: args.selectedAssertionId,
        reason: args.reason,
      }),
    "relationships:runCommitmentRecovery": async (_event, args) => runCommitmentRecovery(args.id),
    "relationships:appendCommitmentTransition": async (_event, args) =>
      appendCommitmentTransition(args.relationshipId, args.commitmentId, args),
    "relationships:createMutualActionPlan": async (_event, args) =>
      createMutualActionPlan(args.relationshipId, args.commitmentIds),
    "relationships:reviseMutualActionPlan": async (_event, args) =>
      reviseMutualActionPlan(args.relationshipId, args.planId, args.items),
    "relationships:approveMutualActionPlan": async (_event, args) =>
      approveMutualActionPlan(args.relationshipId, args.planId),
    "relationships:shareMutualActionPlan": async (_event, args) =>
      shareMutualActionPlan(args.relationshipId, args.planId),
    "relationships:requestConversationDeletion": async (_event, args) =>
      requestConversationDeletion(args.relationshipId, args.requestId),
    "relationships:approve": async (_event, args) =>
      approveRelationshipRecommendation(args.actionId, args.acceptRisk),
    "relationships:reject": async (_event, args) =>
      rejectRelationshipRecommendation(args.actionId, args.reason),
    "workspace:getRoot": async () => {
      return workspace.getRoot();
    },
    "workspace:exists": async (_, args) => {
      return workspace.exists(args.path);
    },
    "workspace:stat": async (_event, args) => {
      return workspace.stat(args.path);
    },
    "workspace:readdir": async (_event, args) => {
      return workspace.readdir(args.path, args.opts);
    },
    "workspace:readFile": async (_event, args) => {
      return workspace.readFile(args.path, args.encoding);
    },
    "workspace:writeFile": async (_event, args) => {
      return workspace.writeFile(args.path, args.data, args.opts);
    },
    "workspace:mkdir": async (_event, args) => {
      return workspace.mkdir(args.path, args.recursive);
    },
    "workspace:rename": async (_event, args) => {
      return workspace.rename(args.from, args.to, args.overwrite);
    },
    "workspace:copy": async (_event, args) => {
      return workspace.copy(args.from, args.to, args.overwrite);
    },
    "workspace:remove": async (_event, args) => {
      return workspace.remove(args.path, args.opts);
    },
    "gmail:getImportant": async (_event, args) => {
      return listImportantThreads({ cursor: args.cursor, limit: args.limit });
    },
    "gmail:getEverythingElse": async (_event, args) => {
      return listEverythingElseThreads({ cursor: args.cursor, limit: args.limit });
    },
    "gmail:triggerSync": async () => {
      triggerGmailSync();
      return {};
    },
    "gmail:sendReply": async (_event, args) => {
      return sendThreadReply(args);
    },
    "gmail:getConnectionStatus": async () => {
      return getGmailConnectionStatus();
    },
    "gmail:getAccountEmail": async () => {
      return { email: await getAccountEmail() };
    },
    "gmail:archiveThread": async (_event, args) => {
      return archiveThread(args.threadId);
    },
    "gmail:trashThread": async (_event, args) => {
      return trashThread(args.threadId);
    },
    "gmail:markThreadRead": async (_event, args) => {
      return markThreadRead(args.threadId);
    },
    "gmail:saveMessageHeight": async (_event, args) => {
      saveMessageBodyHeight(args.threadId, args.messageId, args.height);
      return {};
    },
    "mcp:listTools": async (_event, args) => {
      return mcpCore.listTools(args.serverName, args.cursor);
    },
    "mcp:executeTool": async (_event, args) => {
      return { result: await mcpCore.executeTool(args.serverName, args.toolName, args.input) };
    },
    "runs:create": async (_event, args) => {
      return runsCore.createRun(args);
    },
    "runs:createMessage": async (_event, args) => {
      return {
        messageId: await runsCore.createMessage(
          args.runId,
          args.message,
          args.voiceInput,
          args.voiceOutput,
          args.searchEnabled,
          args.middlePaneContext,
          args.codeMode,
        ),
      };
    },
    "runs:authorizePermission": async (_event, args) => {
      await runsCore.authorizePermission(args.runId, args.authorization);
      return { success: true };
    },
    "codeRun:resolvePermission": async (_event, args) => {
      const registry = container.resolve<CodePermissionRegistry>("codePermissionRegistry");
      registry.resolve(args.requestId, args.decision);
      return { success: true };
    },
    "runs:provideHumanInput": async (_event, args) => {
      await runsCore.replyToHumanInputRequest(args.runId, args.reply);
      return { success: true };
    },
    "runs:stop": async (_event, args) => {
      await runsCore.stop(args.runId, args.force);
      return { success: true };
    },
    "runs:fetch": async (_event, args) => {
      return runsCore.fetchRun(args.runId);
    },
    "runs:list": async (_event, args) => {
      return runsCore.listRuns(args);
    },
    "runs:delete": async (_event, args) => {
      await runsCore.deleteRun(args.runId);
      return { success: true };
    },
    "runs:downloadLog": async (event, args) => {
      const runFileName = `${args.runId}.jsonl`;
      if (path.basename(runFileName) !== runFileName) {
        return { success: false, error: "Invalid run id" };
      }

      const sourcePath = path.join(WorkDir, "runs", runFileName);
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${runFileName}.log`,
        filters: [
          { name: "Chat Log", extensions: ["log"] },
          { name: "JSONL", extensions: ["jsonl"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      try {
        await fs.copyFile(sourcePath, result.filePath);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to download chat log";
        return { success: false, error: message };
      }
    },
    "models:list": async () => {
      if (await isSignedIn()) {
        return await listGatewayModels();
      }
      return await listOnboardingModels();
    },
    "models:test": async (_event, args) => {
      return await testModelConnection(args.provider, args.model);
    },
    "models:saveConfig": async (_event, args) => {
      const repo = container.resolve<IModelConfigRepo>("modelConfigRepo");
      await repo.setConfig(args);
      return { success: true };
    },
    "oauth:connect": async (_event, args) => {
      const credentials =
        args.clientId && args.clientSecret
          ? { clientId: args.clientId.trim(), clientSecret: args.clientSecret.trim() }
          : undefined;
      return await connectProvider(args.provider, credentials);
    },
    "oauth:disconnect": async (_event, args) => {
      return await disconnectProvider(args.provider);
    },
    "connectors:connect": async (_event, args) => {
      // Starts the connector OAuth flow + opens the browser. The browser
      // completes at the api callback, which deep-links back and main redeems
      // the grant via the connector /claim endpoint (see deeplink.ts).
      return await connectConnector(args.connector);
    },
    "connectors:list": async () => {
      try {
        return await listConnectorsViaBackend();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to list integrations";
        return { connectors: [], error: message };
      }
    },
    "connectors:saveApiKey": async (_event, args) => {
      try {
        await saveConnectorAPIKeyViaBackend(args.connector, args.apiKey);
        invalidateCopilotInstructionsCache();
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to save integration API key";
        return { success: false, error: message };
      }
    },
    "connectors:disconnect": async (_event, args) => {
      try {
        await deleteConnectorViaBackend(args.connector);
        invalidateCopilotInstructionsCache();
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to disconnect integration";
        return { success: false, error: message };
      }
    },
    "slack:connectWorkspace": async () => {
      // Opens the api's Slack install front door; the deep-link dispatcher
      // redeems the parked bundle via /v1/slack-oauth/claim (see deeplink.ts).
      return await connectSlackWorkspace();
    },
    "oauth:list-providers": async () => {
      return listProviders();
    },
    "oauth:getState": async () => {
      const repo = container.resolve<IOAuthRepo>("oauthRepo");
      const config = await repo.getClientFacingConfig();
      return { config };
    },
    "account:getSolomon": async () => getSolomonAccountState(),
    "granola:getConfig": async () => {
      const repo = container.resolve<IGranolaConfigRepo>("granolaConfigRepo");
      const config = await repo.getConfig();
      return { enabled: config.enabled };
    },
    "codeMode:getConfig": async () => {
      const repo = container.resolve<ICodeModeConfigRepo>("codeModeConfigRepo");
      const config = await repo.getConfig();
      return { enabled: config.enabled, approvalPolicy: config.approvalPolicy };
    },
    "codeMode:setConfig": async (_event, args) => {
      const repo = container.resolve<ICodeModeConfigRepo>("codeModeConfigRepo");
      await repo.setConfig({ enabled: args.enabled, approvalPolicy: args.approvalPolicy });
      invalidateCopilotInstructionsCache();
      return { success: true };
    },
    "codeMode:checkAgentStatus": async () => {
      return await checkCodeModeAgentStatus();
    },
    "granola:setConfig": async (_event, args) => {
      const repo = container.resolve<IGranolaConfigRepo>("granolaConfigRepo");
      await repo.setConfig({ enabled: args.enabled });

      // Trigger sync immediately when enabled
      if (args.enabled) {
        triggerGranolaSync();
      }

      return { success: true };
    },
    "slack:getConfig": async () => {
      const repo = container.resolve<ISlackConfigRepo>("slackConfigRepo");
      let managedError: string | undefined;
      try {
        const managed = await listSlackWorkspacesViaBackend();
        if (managed.workspaces.length > 0) {
          return {
            enabled: true,
            workspaces: managed.workspaces.map((workspace) => ({
              teamId: workspace.teamId,
              name: workspace.teamName || workspace.teamId,
              scopes: workspace.scopes,
              connectedAt: workspace.connectedAt,
              source: "managed" as const,
            })),
          };
        }
      } catch (err: unknown) {
        managedError =
          err instanceof Error ? err.message : "Failed to load managed Slack workspaces";
      }
      const config = await repo.getConfig();
      return {
        enabled: config.enabled,
        workspaces: config.workspaces.map((workspace) => ({
          ...workspace,
          source: "local" as const,
        })),
        error: managedError,
      };
    },
    "slack:setConfig": async (_event, args) => {
      const repo = container.resolve<ISlackConfigRepo>("slackConfigRepo");
      await repo.setConfig({ enabled: args.enabled, workspaces: args.workspaces });
      invalidateCopilotInstructionsCache();
      return { success: true };
    },
    "slack:disconnectWorkspace": async (_event, args) => {
      try {
        if (args.teamId) {
          await deleteSlackWorkspaceViaBackend(args.teamId);
        } else {
          const repo = container.resolve<ISlackConfigRepo>("slackConfigRepo");
          await repo.setConfig({ enabled: false, workspaces: [] });
        }
        invalidateCopilotInstructionsCache();
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to disconnect Slack";
        return { success: false, error: message };
      }
    },
    "slack:sendReplyDraft": async (_event, args) => {
      try {
        const response = await postSlackThreadReplyViaBackend({
          teamId: args.teamId,
          channel: args.channel,
          threadTs: args.threadTs,
          text: args.text,
        });
        return {
          success: response.ok,
          teamId: response.teamId,
          channel: response.channel,
          threadTs: response.threadTs,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to send Slack reply";
        return { success: false, error: message };
      }
    },
    "slack:listWorkspaces": async () => {
      try {
        await ensureAgentSlackAvailable();
        const { stdout } = await execAsync("agent-slack auth whoami", { timeout: 10000 });
        const parsed = JSON.parse(stdout);
        const workspaces = (parsed.workspaces || []).map(
          (w: { workspace_url?: string; workspace_name?: string }) => ({
            url: w.workspace_url || "",
            name: w.workspace_name || "",
          }),
        );
        return { workspaces };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to list Slack workspaces";
        return { workspaces: [], error: message };
      }
    },
    "onboarding:getStatus": async () => {
      // Show onboarding if it hasn't been completed yet
      const complete = isOnboardingComplete();
      return { showOnboarding: !complete };
    },
    "onboarding:markComplete": async () => {
      markOnboardingComplete();
      return { success: true };
    },
    // Agent schedule handlers
    "agent-schedule:getConfig": async () => {
      const repo = container.resolve<IAgentScheduleRepo>("agentScheduleRepo");
      try {
        return await repo.getConfig();
      } catch {
        // Return empty config if file doesn't exist
        return { agents: {} };
      }
    },
    "agent-schedule:getState": async () => {
      const repo = container.resolve<IAgentScheduleStateRepo>("agentScheduleStateRepo");
      try {
        return await repo.getState();
      } catch {
        // Return empty state if file doesn't exist
        return { agents: {} };
      }
    },
    "agent-schedule:updateAgent": async (_event, args) => {
      const agentName = args.agentName.trim();
      if (!agentName) {
        throw new Error("Agent name is required");
      }
      try {
        await loadAgent(agentName);
      } catch {
        throw new Error(`Agent "${agentName}" not found`);
      }
      const repo = container.resolve<IAgentScheduleRepo>("agentScheduleRepo");
      await repo.upsert(agentName, args.entry);
      // Recompute nextRunAt from the (possibly changed) schedule so the runner
      // honors the new cadence on its next tick instead of firing on the stale
      // nextRunAt (which used the old schedule, or a past time after re-enable). (ERRORS.md E58)
      try {
        const stateRepo = container.resolve<IAgentScheduleStateRepo>("agentScheduleStateRepo");
        const nextRunAt = calculateAgentNextRunAt(args.entry.schedule);
        await stateRepo.updateAgentState(agentName, { nextRunAt });
      } catch (e) {
        console.error("[agent-schedule:updateAgent] failed to recompute nextRunAt", e);
      }
      // Trigger the runner to pick up the change immediately
      triggerAgentScheduleRun();
      return { success: true };
    },
    "agent-schedule:deleteAgent": async (_event, args) => {
      const repo = container.resolve<IAgentScheduleRepo>("agentScheduleRepo");
      const stateRepo = container.resolve<IAgentScheduleStateRepo>("agentScheduleStateRepo");
      await repo.delete(args.agentName);
      await stateRepo.deleteAgentState(args.agentName);
      return { success: true };
    },
    // Shell integration handlers
    "shell:openPath": async (_event, args) => {
      const filePath = resolveShellPath(args.path);
      const error = await shell.openPath(filePath);
      return { error: error || undefined };
    },
    "shell:showItemInFolder": async (_event, args) => {
      const filePath = resolveShellPath(args.path);
      shell.showItemInFolder(filePath);
      return { success: true };
    },
    "shell:readFileBase64": async (_event, args) => {
      const filePath = resolveShellPath(args.path);
      const stat = await fs.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        throw new Error("File too large (>10MB)");
      }
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".ico": "image/x-icon",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
        ".pdf": "application/pdf",
        ".json": "application/json",
        ".txt": "text/plain",
        ".md": "text/markdown",
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";
      return { data: buffer.toString("base64"), mimeType, size: stat.size };
    },
    "dialog:openDirectory": async (event, args) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const defaultPath = args.defaultPath ? resolveShellPath(args.defaultPath) : os.homedir();
      const result = await dialog.showOpenDialog(win!, {
        title: args.title ?? "Choose work directory",
        defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { path: null };
      }
      return { path: result.filePaths[0] ?? null };
    },
    // Knowledge version history handlers
    "knowledge:history": async (_event, args) => {
      const commits = await versionHistory.getFileHistory(args.path);
      return { commits };
    },
    "knowledge:fileAtCommit": async (_event, args) => {
      const content = await versionHistory.getFileAtCommit(args.path, args.oid);
      return { content };
    },
    "knowledge:restore": async (_event, args) => {
      await versionHistory.restoreFile(args.path, args.oid);
      return { ok: true };
    },
    // Search handler
    "search:query": async (_event, args) => {
      return search(args.query, args.limit, args.types);
    },
    // Semantic memory handlers (RFC 021)
    "memory:search": async (_event, args) => {
      const res = await memorySearch(args.query, { k: args.k, pathPrefix: args.pathPrefix });
      return { mode: res.mode, results: res.results };
    },
    "memory:related": async (_event, args) => {
      return { related: relatedNotes(args.path, args.k ?? 8) };
    },
    "memory:status": async () => {
      return memoryStatus();
    },
    "memory:rebuild": async () => {
      const result = await rebuildMemoryIndex();
      if ("disabled" in result) {
        return { disabled: true, rebuilt: false, chunkCount: 0, filesProcessed: 0 };
      }
      memoryBus.publish({
        chunkCount: result.chunkCount,
        filesProcessed: result.filesProcessed,
        chunksNew: result.chunksNew,
        tokens: result.tokens,
        rebuilt: true,
        durationMs: result.durationMs,
      });
      return {
        disabled: false,
        rebuilt: true,
        chunkCount: result.chunkCount,
        filesProcessed: result.filesProcessed,
      };
    },
    // Inline task schedule classification
    "export:note": async (event, args) => {
      const { markdown, format, title } = args;
      const sanitizedTitle = title.replace(/[/\\?%*:|"<>]/g, "-").trim() || "Untitled";

      const filterMap: Record<string, Electron.FileFilter[]> = {
        md: [{ name: "Markdown", extensions: ["md"] }],
        pdf: [{ name: "PDF", extensions: ["pdf"] }],
        docx: [{ name: "Word Document", extensions: ["docx"] }],
      };

      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${sanitizedTitle}.${format}`,
        filters: filterMap[format],
      });

      if (result.canceled || !result.filePath) {
        return { success: false };
      }

      const filePath = result.filePath;

      if (format === "md") {
        await fs.writeFile(filePath, markdown, "utf8");
        return { success: true };
      }

      if (format === "pdf") {
        // Render markdown as HTML in a hidden window, then print to PDF
        const htmlContent = markdownToHtml(markdown, sanitizedTitle);
        const hiddenWin = new BrowserWindow({
          show: false,
          width: 800,
          height: 600,
          webPreferences: {
            offscreen: true,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        // Not an app window. Without this it counts in `appWindows()`, so closing it
        // could quit the app on Windows/Linux and, while a PDF renders, a dock click
        // would decline to re-create the real window.
        markSecondaryWindow(hiddenWin);
        await hiddenWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
        // Small delay to ensure CSS/fonts render
        await new Promise((resolve) => setTimeout(resolve, 300));
        const pdfBuffer = await hiddenWin.webContents.printToPDF({
          printBackground: true,
          pageSize: "A4",
        });
        hiddenWin.destroy();
        await fs.writeFile(filePath, pdfBuffer);
        return { success: true };
      }

      if (format === "docx") {
        const htmlContent = markdownToHtml(markdown, sanitizedTitle);
        const { default: htmlToDocx } = await import("html-to-docx");
        const docxBuffer = await htmlToDocx(htmlContent, undefined, {
          table: { row: { cantSplit: true } },
          footer: false,
          header: false,
        });
        await fs.writeFile(filePath, Buffer.from(docxBuffer as ArrayBuffer));
        return { success: true };
      }

      return { success: false, error: "Unknown format" };
    },
    "meeting:checkScreenPermission": async () => {
      if (process.platform !== "darwin") return { granted: true };
      const status = systemPreferences.getMediaAccessStatus("screen");
      console.log("[meeting] Screen recording permission status:", status);
      if (status === "granted") return { granted: true };
      // Not granted — call desktopCapturer.getSources() to register the app
      // in the macOS Screen Recording list. On first call this shows the
      // native permission prompt (signed apps are remembered across restarts).
      try {
        await desktopCapturer.getSources({ types: ["screen"] });
      } catch {
        /* ignore */
      }
      // Re-check after the native prompt was dismissed
      const statusAfter = systemPreferences.getMediaAccessStatus("screen");
      console.log("[meeting] Screen recording permission status after prompt:", statusAfter);
      return { granted: statusAfter === "granted" };
    },
    "meeting:openScreenRecordingSettings": async () => {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      );
      return { success: true };
    },
    "meeting:summarize": async (_event, args) => {
      const notes = await summarizeMeeting(
        args.transcript,
        args.meetingStartTime,
        args.calendarEventJson,
      );
      return { notes };
    },
    "inline-task:classifySchedule": async (_event, args) => {
      const schedule = await classifySchedule(args.instruction);
      return { schedule };
    },
    "inline-task:process": async (_event, args) => {
      return await processSolomonInstruction(args.instruction, args.noteContent, args.notePath);
    },
    "voice:getConfig": async () => {
      return voice.getVoiceConfig();
    },
    "voice:synthesize": async (_event, args) => {
      return voice.synthesizeSpeech(args.text);
    },
    "voice:parseCommand": async (_event, { text, surface }) => {
      return parseVoiceCommand(text, surface);
    },
    "voice:executeCommand": async (_event, { intent, confirmed }) => {
      return executeVoiceCommand(intent, {
        confirmed,
        emailActions: unavailableEmailActions,
      });
    },
    "dictation:getStatus": async () => desktopDictationStatus(),
    "dictation:getRecovery": async () => getDesktopDictationRecovery(),
    "dictation:getHistory": async (_event, options) => {
      const cfg = await voice.getTranscriptionConfig();
      const page = await getDesktopDictationHistory(options, cfg.dictation.historyRetention);
      return { ...page, retention: cfg.dictation.historyRetention };
    },
    "dictation:copyHistoryEntry": async (_event, { id }) => copyDesktopDictationHistoryEntry(id),
    "dictation:toggleHistoryFormatting": async (_event, { id }) => {
      const entry = await toggleDesktopDictationHistoryFormatting(id);
      return entry
        ? { success: true, entry }
        : { success: false, error: "The original transcript is unavailable." };
    },
    "dictation:deleteHistoryEntry": async (_event, { id }) => ({
      success: await deleteDesktopDictationHistoryEntry(id),
    }),
    "dictation:clearHistory": async () => {
      await clearDesktopDictationHistory();
      return { success: true };
    },
    "dictation:pasteLast": async () => pasteLastDesktopDictation(),
    "dictation:copyLast": async () => copyLastDesktopDictation(),
    "dictation:requestAccessibility": async () => ({
      trusted: requestDictationAccessibility(),
    }),
    "dictation:openInputMonitoring": async () => ({
      opened: await openInputMonitoringSettings(),
    }),
    "dictation:updateState": async (_event, { state, message }) => {
      updateDesktopDictationState(state, message);
      return { ok: true };
    },
    "dictation:controlDock": async (_event, { action }) =>
      controlDesktopDictationDock(action),
    "dictation:transcribe": async (_event, req) => {
      const pcm16 = new Int16Array(req.pcm16);
      const cfg = await voice.getTranscriptionConfig();
      const store = desktopDictationAudioRecoveryStore();
      const staged =
        cfg.dictation.retryFailedAudio && req.retainForRetry !== false
          ? store.stage(pcm16, req.sampleRate).catch((error) => {
              console.warn("[dictation] could not stage retry audio", error);
              return null;
            })
          : null;
      const result = await transcribeDictationPcm(pcm16, cfg, req.lang);
      if (staged) {
        if (result.success) {
          void staged
            .then((value) => (value ? store.discard(value) : undefined))
            .catch((error) => console.warn("[dictation] could not discard staged audio", error));
        } else {
          const value = await staged;
          const historyId =
            req.retainForRetry !== false
              ? await recordFailedDesktopDictation(
                  {
                    audioDurationMs: (pcm16.length / req.sampleRate) * 1_000,
                    engine: "unknown",
                    errorCode: result.code,
                    language: req.lang ?? cfg.dictation.language,
                  },
                  cfg.dictation.historyRetention,
                )
              : undefined;
          if (value) {
            await store.markFailed(value, result.code, result.message, historyId);
            notifyDesktopDictationHistoryChanged();
          }
        }
      } else if (!result.success && req.retainForRetry !== false) {
        await recordFailedDesktopDictation(
          {
            audioDurationMs: (pcm16.length / req.sampleRate) * 1_000,
            engine: "unknown",
            errorCode: result.code,
            language: req.lang ?? cfg.dictation.language,
          },
          cfg.dictation.historyRetention,
        );
      }
      return result;
    },
    "dictation:retryFailed": async (_event, request) => {
      const store = desktopDictationAudioRecoveryStore();
      const failed = await store.read();
      if (!failed) return { success: false, error: "No failed dictation audio is available." };
      if (request?.id && request.id !== failed.historyId) {
        return {
          success: false,
          error: "Audio for that failed transcript is no longer available.",
        };
      }
      const cfg = await voice.getTranscriptionConfig();
      const result = await transcribeDictationPcm(failed.pcm16, cfg, cfg.dictation.language);
      if (!result.success) {
        return {
          success: false,
          error: "Retry did not produce a transcript. The audio is still saved.",
        };
      }
      if (request?.id) {
        const recovered = await completeFailedDesktopDictationHistory(
          request.id,
          result.text,
          cfg.dictation,
          {
            audioDurationMs: failed.durationMs,
            transcriptionDurationMs: result.durationMs,
            engine: result.engine,
            language: result.language,
          },
        );
        if (!recovered) {
          return { success: false, error: "That failed transcript is no longer available." };
        }
        await store.clear();
        return { success: true };
      }
      const pasted = await pasteDesktopDictation(result.text, cfg.dictation, {
        audioDurationMs: failed.durationMs,
        transcriptionDurationMs: result.durationMs,
        engine: result.engine,
        language: result.language,
        historyId: failed.historyId,
      });
      await store.clear();
      return pasted;
    },
    "dictation:applyCommand": async (_event, { instruction }) => {
      const context = await consumeDesktopCommandContext();
      if (!context) {
        return { success: false, error: "Could not read the focused text field." };
      }
      if (context.sensitive) {
        return { success: false, error: "Command Mode is unavailable in password fields." };
      }
      if (context.selectedTextLength > context.selectedText.length) {
        return {
          success: false,
          error: "The selection is too large for Command Mode. Select a smaller passage.",
        };
      }
      try {
        const cfg = await voice.getTranscriptionConfig();
        const transformed = await transformDictationCommand({
          instruction,
          selectedText: context.selectedText,
          beforeText: context.beforeText,
          afterText: context.afterText,
          appName: context.appName,
          localOnly: cfg.privacy.localOnly,
        });
        const pasted = await pasteDesktopCommandResult(transformed.text, context);
        return { ...pasted, source: transformed.source };
      } catch (error) {
        console.warn("[dictation] Command Mode failed", error);
        return {
          success: false,
          error:
            error instanceof Error && error.name === "DictationCommandPrivacyError"
              ? error.message
              : "Command Mode could not complete that edit. Your original text was not changed.",
        };
      }
    },
    "dictation:saveFailedAudio": async (_event, req) => {
      const cfg = await voice.getTranscriptionConfig();
      try {
        const historyId = await recordFailedDesktopDictation(
          {
            audioDurationMs: (new Int16Array(req.pcm16).length / req.sampleRate) * 1_000,
            engine: "unknown",
            errorCode: req.errorCode ?? "cloud_transcription_failed",
            language: req.language ?? cfg.dictation.language,
          },
          cfg.dictation.historyRetention,
        );
        if (!cfg.dictation.retryFailedAudio) return { saved: false };
        const store = desktopDictationAudioRecoveryStore();
        const staged = await store.stage(new Int16Array(req.pcm16), req.sampleRate);
        await store.markFailed(
          staged,
          req.errorCode ?? "cloud_transcription_failed",
          undefined,
          historyId,
        );
        notifyDesktopDictationHistoryChanged();
        return { saved: true };
      } catch (error) {
        console.warn("[dictation] could not save failed cloud audio", error);
        return { saved: false };
      }
    },
    "dictation:commit": async (
      _event,
      { text, audioDurationMs, transcriptionDurationMs, engine, language },
    ) => {
      const config = await voice.getTranscriptionConfig();
      return pasteDesktopDictation(text, config.dictation, {
        audioDurationMs,
        transcriptionDurationMs,
        engine,
        language,
      });
    },
    // ---- Local on-device transcription (whisper.cpp) — RFC 009 ----
    "whisper:capability": async () => {
      return getWhisper().capability();
    },
    "whisper:diagnose": async (_event, req) => {
      const cfg = await voice.getTranscriptionConfig();
      return getWhisper().diagnose({
        pcm16: new Int16Array(req.pcm16),
        sampleRate: req.sampleRate,
        model: cfg.whisper.model,
        lang: cfg.whisper.language,
        expectedText: req.expectedText,
        retainDiagnostics: cfg.privacy.retainDiagnostics,
      });
    },
    "whisper:listModels": async () => {
      return { models: await getWhisper().listModels() };
    },
    "whisper:verifyModel": async (_event, { id }) => {
      return getWhisper().verifyModel(id);
    },
    "whisper:ensureModel": async (_event, { id }) => {
      try {
        await getWhisper().ensureModel(id);
        return { success: true };
      } catch (err) {
        return { success: false, code: whisperCodeOf(err, "download_failed") };
      }
    },
    "whisper:repairModel": async (_event, { id }) => {
      return getWhisper().repairModel(id);
    },
    "whisper:removeModel": async (_event, { id }) => {
      await getWhisper().removeModel(id);
      return { success: true };
    },
    "whisper:benchmark": async (_event, req) =>
      getWhisper().benchmark({ model: req.model, sampleSeconds: req.sampleSeconds }),
    "whisper:transcribe": async (_event, req) => {
      try {
        // Honor the persisted model/language when the renderer didn't specify one
        // (the settings model picker writes whisper.model; callers send neither).
        const cfg = await voice.getTranscriptionConfig();
        const pcm16 = new Int16Array(req.pcm16);
        const sampleCount = pcm16.length;
        const levels = pcmStats(pcm16, req.channels);
        const model = req.model ?? cfg.whisper.model;
        const lang = req.lang ?? cfg.whisper.language;
        console.log("[voice] whisper:transcribe start", {
          samples: sampleCount,
          audioMs: (sampleCount / 16000 / (req.channels === 2 ? 2 : 1)) * 1000,
          channels: req.channels,
          model,
          lang,
          peak: levels.peak,
          rms: Number(levels.rms.toFixed(1)),
          activePct: Number((levels.activeRatio * 100).toFixed(1)),
        });
        const result = await getWhisper().transcribe(pcm16, {
          channels: req.channels,
          model,
          lang,
        });
        console.log("[voice] whisper:transcribe success", {
          textLength: result.text.length,
          rtf: result.rtf,
          durationMs: result.durationMs,
        });
        return {
          success: true,
          text: result.text,
          segments: result.segments,
          rtf: result.rtf,
          durationMs: result.durationMs,
        };
      } catch (err) {
        console.error("[voice] whisper:transcribe failed", err);
        return { success: false, code: whisperCodeOf(err), message: (err as Error)?.message };
      }
    },
    "whisper:openStream": async (event, { model, channels }) => {
      // Resolve the model (honoring the persisted choice when the meeting hook sends none)
      // BEFORE allocating the channel — if the config read ever threw, allocating first would
      // leak the two native MessagePorts that only the catch below knows how to close.
      const resolvedModel = model ?? (await voice.getTranscriptionConfig()).whisper.model;
      // Open a MessageChannel; the Session owns port1, the renderer gets port2 (transferred).
      const { port1, port2 } = new MessageChannelMain();
      let streamId: string;
      try {
        streamId = getWhisper().openStream(port1 as unknown as StreamPort, {
          model: resolvedModel,
          channels,
        });
      } catch (err) {
        port1.close();
        return { streamId: "", code: whisperCodeOf(err) };
      }
      // Transfer the renderer-side port out-of-band (can't ride the zod invoke result).
      event.senderFrame?.postMessage("whisper:streamPort", { streamId }, [port2]);
      return { streamId };
    },
    "whisper:closeStream": async (_event, { streamId }) => {
      getWhisper().closeStream(streamId);
      return { success: true };
    },
    "transcription:getVoiceProvider": async () => {
      return { provider: await resolveVoiceProviderMain() };
    },
    "transcription:getMeetingProvider": async () => {
      return resolveMeetingProviderMain();
    },
    "transcription:getRouting": async () => {
      return transcriptionRoutingMain();
    },
    "transcription:getConfig": async () => {
      return voice.getTranscriptionConfig();
    },
    "transcription:setConfig": async (_event, patch) => {
      const next = await voice.setTranscriptionConfig({
        voiceProvider: patch.voiceProvider,
        meetingProvider: patch.meetingProvider,
        ...(patch.model ? { whisper: { model: patch.model } } : {}),
        privacy: patch.privacy,
        ...(patch.dictation ? { dictation: patch.dictation } : {}),
        // RFC 017: persist the on-device diarization beta toggle + tunables.
        ...(patch.diarization ? { diarization: patch.diarization } : {}),
        // Native capture: engine choice, echo cancellation, audio retention.
        ...(patch.meetings ? { meetings: patch.meetings } : {}),
      });
      if (patch.meetings) {
        await getMeetingController({ whisper: getWhisper }).refreshSettings();
      }
      if (patch.dictation) applyDesktopDictationSettings(next.dictation);
      return next;
    },
    "notifications:getConfig": async () => {
      return getNotificationsConfig();
    },
    "notifications:setConfig": async (_event, patch) => {
      return setNotificationsConfig(patch);
    },
    // Live-note handlers
    "live-note:run": async (_event, args) => {
      const result = await runLiveNoteAgent(args.filePath, "manual", args.context);
      return {
        success: !result.error,
        runId: result.runId,
        action: result.action,
        summary: result.summary,
        contentAfter: result.contentAfter,
        error: result.error,
      };
    },
    "live-note:get": async (_event, args) => {
      try {
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "live-note:set": async (_event, args) => {
      try {
        await setLiveNote(args.filePath, args.live);
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "live-note:setActive": async (_event, args) => {
      try {
        await setLiveNoteActive(args.filePath, args.active);
        const live = await fetchLiveNote(args.filePath);
        return { success: true, live };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "live-note:delete": async (_event, args) => {
      try {
        await deleteLiveNote(args.filePath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "live-note:stop": async (_event, args) => {
      try {
        const live = await fetchLiveNote(args.filePath);
        if (!live?.lastRunId) {
          return { success: false, error: "No active run for this note" };
        }
        await runsCore.stop(live.lastRunId, false);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "live-note:listNotes": async () => {
      const notes = await listLiveNotes();
      return { notes };
    },
    // Bg-task handlers
    "bg-task:run": async (_event, args) => {
      try {
        const task = await fetchTask(args.slug);
        if ((task?.executionTarget ?? "desktop") === "api") {
          const run = await triggerCloudRun(args.slug, "manual", args.context);
          return {
            success: true,
            runId: run.runId,
            summary: run.summary,
            run,
          };
        }
        const result = await runBackgroundTask(args.slug, "manual", args.context);
        return {
          success: !result.error,
          runId: result.runId,
          summary: result.summary,
          error: result.error,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:get": async (_event, args) => {
      try {
        const task = await fetchTask(args.slug);
        return { success: true, task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:patch": async (_event, args) => {
      try {
        const task = await patchTask(args.slug, args.partial);
        return { success: true, task };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:create": async (_event, args) => {
      try {
        const { slug } = await createTask({
          name: args.name,
          instructions: args.instructions,
          ...(args.triggers ? { triggers: args.triggers } : {}),
          ...(args.model ? { model: args.model } : {}),
          ...(args.provider ? { provider: args.provider } : {}),
          ...(args.executionTarget ? { executionTarget: args.executionTarget } : {}),
        });
        return { success: true, slug };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:delete": async (_event, args) => {
      try {
        await deleteTask(args.slug);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:stop": async (_event, args) => {
      try {
        const task = await fetchTask(args.slug);
        if (!task?.lastRunId) {
          return { success: false, error: "No active run for this task" };
        }
        await runsCore.stop(task.lastRunId, false);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:list": async (_event, args) => {
      return listTasks(args);
    },
    "bg-task:listRunIds": async (_event, args) => {
      const runIds = await readTaskRunIds(args.slug, args.limit);
      return { runIds };
    },
    "bg-task:triggerCloudRun": async (_event, args) => {
      try {
        const run = await triggerCloudRun(args.slug, args.trigger ?? "manual", args.context);
        return { success: true, run };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:getCloudRunStatus": async (_event, args) => {
      try {
        const status = await getCloudRunStatus(args.slug, args.runId);
        return { success: true, status };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:listCloudRuns": async (_event, args) => {
      try {
        const result = await listCloudRuns(args.slug, {
          ...(args.status ? { status: args.status } : {}),
          ...(args.executor ? { executor: args.executor } : {}),
          ...(args.limit ? { limit: args.limit } : {}),
          ...(args.cursor ? { cursor: args.cursor } : {}),
        });
        return {
          success: true,
          runs: result.runs,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
      } catch (err) {
        return {
          success: false,
          runs: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    "bg-task:listCloudRunEvents": async (_event, args) => {
      try {
        const events = await listCloudRunEvents(args.slug, args.runId, args.afterSeq);
        return { success: true, events };
      } catch (err) {
        return {
          success: false,
          events: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    "bg-task:cancelCloudRun": async (_event, args) => {
      try {
        const run = await cancelCloudRun(args.slug, args.runId);
        return { success: true, run };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:retryCloudRun": async (_event, args) => {
      try {
        const run = await retryCloudRun(args.slug, args.runId);
        return { success: true, run };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:signalCloudRun": async (_event, args) => {
      try {
        const run = await signalCloudRun(args.slug, args.runId, args.signal, args.payload);
        return { success: true, run };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:pullCloudArtifact": async (_event, args) => {
      try {
        await syncArtifactFromCloud(args.slug);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:listAllCloudRuns": async (_event, args) => {
      try {
        const result = await listAllCloudRuns({
          ...(args.status ? { status: args.status } : {}),
          ...(args.trigger ? { trigger: args.trigger } : {}),
          ...(args.executor ? { executor: args.executor } : {}),
          ...(args.slug ? { slug: args.slug } : {}),
          ...(args.since ? { since: args.since } : {}),
          ...(args.until ? { until: args.until } : {}),
          ...(args.limit ? { limit: args.limit } : {}),
          ...(args.cursor ? { cursor: args.cursor } : {}),
        });
        return {
          success: true,
          runs: result.runs,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
      } catch (err) {
        return {
          success: false,
          runs: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    "bg-task:rerunCloudRun": async (_event, args) => {
      try {
        const run = await rerunCloudRun(args.slug, args.runId);
        return { success: true, run };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:getArtifactSyncState": async (_event, args) => {
      try {
        const sync = await getArtifactSyncState(args.slug);
        return { success: true, sync };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:getCloudRun": async (_event, args) => {
      try {
        const run = await getCloudRun(args.slug, args.runId);
        return { success: true, run };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    "bg-task:getCloudScheduleState": async (_event, args) => {
      try {
        const state = await getCloudScheduleState(args.slug);
        return { success: true, state };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    // Billing handler
    "billing:getInfo": async () => {
      return await getBillingInfo();
    },
    "billing:getCheckoutUrl": async (_event, args) => {
      const url = await createBillingCheckoutSession(args.plan);
      return { url };
    },
    "billing:getPortalUrl": async () => {
      const url = await getBillingPortalUrl();
      return { url };
    },
    "billing:sync": async () => {
      await syncBilling();
      return { success: true };
    },
    // Feedback handler (relayed to Plain via the backend)
    "feedback:submit": async (_event, args) => {
      try {
        await submitFeedback({
          category: args.category,
          message: args.message,
          appVersion: app.getVersion(),
          platform: `${process.platform}/${process.arch}`,
        });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Branch on the typed auth reason rather than substring-matching the
        // message (which breaks for reconnect_required/refresh_backoff and is
        // fragile to wording changes). (ERRORS.md E54)
        let errorCode: "not_signed_in" | "server" = "server";
        if (err instanceof AuthUnavailableError) {
          // not_signed_in + reconnect_required both need the user to (re)auth →
          // prompt sign-in; refresh_backoff is transient → generic retry.
          errorCode = err.reason === "refresh_backoff" ? "server" : "not_signed_in";
        } else if (message.includes("Not signed into")) {
          errorCode = "not_signed_in";
        }
        return {
          success: false,
          errorCode,
          error: message,
        };
      }
    },
    // Embedded browser handlers (WebContentsView + navigation)
    ...browserIpcHandlers,
    // Provider-neutral mailbox handlers (email-001..004)
    ...mailboxIpcHandlers,
    // Native dual-track meeting capture (oppulence-audiocap sidecar)
    ...createMeetingIpcHandlers({ whisper: getWhisper }),
  });
}
