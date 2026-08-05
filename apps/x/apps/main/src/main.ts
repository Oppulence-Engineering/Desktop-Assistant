import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  protocol,
  net,
  shell,
  session,
  type Session,
} from "electron";
import path from "node:path";
import {
  initMeetingCapture,
  setupIpcHandlers,
  startRunsWatcher,
  startServicesWatcher,
  startLiveNoteAgentWatcher,
  startBackgroundTaskAgentWatcher,
  startMemoryWatcher,
  startWorkspaceWatcher,
  stopRunsWatcher,
  stopServicesWatcher,
  stopWorkspaceWatcher,
} from "./ipc.js";
import { destroyMeetingTray, stopCaptureForQuit } from "./tray.js";
import { destroyMeetingIndicator } from "./meeting-indicator.js";
import { destroyDesktopDictation, initDesktopDictation } from "./desktop-dictation.js";
import { calendarNotifyHooks } from "./meeting-autostart.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { initUpdates } from "./update-manager.js";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { initEmailRelationshipEvidence } from "@x/core/dist/relationships/email-sync-bridge.js";
import { initCalendarAttendance } from "@x/core/dist/relationships/calendar-attendance.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initMemoryIndexing } from "@x/core/dist/memory/sync.js";
import { init as initEmailLabeling } from "@x/core/dist/knowledge/label_emails.js";
import { init as initNoteTagging } from "@x/core/dist/knowledge/tag_notes.js";
import { init as initInlineTasks } from "@x/core/dist/knowledge/inline_tasks.js";
import { init as initAgentRunner } from "@x/core/dist/agent-schedule/runner.js";
import { init as initAgentNotes } from "@x/core/dist/knowledge/agent_notes.js";
import { init as initCalendarNotifications } from "@x/core/dist/knowledge/notify_calendar_meetings.js";
import { init as initLiveNoteScheduler } from "@x/core/dist/knowledge/live-note/scheduler.js";
import { init as initEventProcessor, registerConsumer } from "@x/core/dist/events/init.js";
import { liveNoteEventConsumer } from "@x/core/dist/knowledge/live-note/event-consumer.js";
import { init as initBackgroundTaskScheduler } from "@x/core/dist/background-tasks/scheduler.js";
import { checkOfflineReturn } from "@x/core/dist/background-tasks/cloud-runs-state.js";
import {
  getNotificationsConfig,
  setNotificationsConfig,
} from "@x/core/dist/config/notifications.js";
import { listTasks } from "@x/core/dist/background-tasks/fileops.js";
import { backgroundTaskEventConsumer } from "@x/core/dist/background-tasks/event-consumer.js";
import {
  init as initLocalSites,
  shutdown as shutdownLocalSites,
} from "@x/core/dist/local-sites/server.js";
import { shutdown as shutdownAnalytics, captureException } from "@x/core/dist/analytics/posthog.js";
import { identifyIfSignedIn } from "@x/core/dist/analytics/identify.js";

import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import { resolveWorkspacePath } from "@x/core/dist/workspace/workspace.js";
import started from "electron-squirrel-startup";
import { init as initChromeSync } from "@x/core/dist/knowledge/chrome-extension/server/server.js";
import container, {
  registerBrowserControlService,
  registerNotificationService,
} from "@x/core/dist/di/container.js";
import type { CodeModeManager } from "@x/core/dist/code-mode/acp/manager.js";
import { browserViewManager, BROWSER_PARTITION } from "./browser/view.js";
import { setupBrowserEventForwarding } from "./browser/ipc.js";
import { ElectronBrowserControlService } from "./browser/control-service.js";
import { ElectronNotificationService } from "./notification/electron-notification-service.js";

const notificationService = new ElectronNotificationService();
import {
  DEEP_LINK_SCHEME,
  LEGACY_DEEP_LINK_SCHEME,
  OLDEST_DEEP_LINK_SCHEME,
  dispatchUrl,
  extractDeepLinkFromArgv,
  setMainWindowForDeepLinks,
} from "./deeplink.js";
import { appWindows, getMainWindow, preloadPath, setMainWindow } from "./main-window.js";
import { getTranscriptionConfig } from "@x/core/dist/voice/voice.js";
import { recordingsRoot } from "@x/core/dist/meetings/meetings.js";
import {
  startCrashReporter,
  processPendingCrashDumps,
  registerLiveCrashListeners,
} from "./crash-reporter.js";
import { initializeExecutionEnvironment } from "./execution-environment.js";
import { disconnectGoogleIfScopesStale } from "./oauth-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Capture uncaught exceptions and unhandled promise rejections in the main
// process and forward them to PostHog. This must be registered as early as
// possible so we don't miss errors thrown during startup. The handlers swallow
// errors from the analytics path itself to avoid recursive crashes.
process.on("uncaughtException", (err) => {
  console.error("[Main] uncaughtException:", err);
  try {
    captureException(err, { process: "main", stage: "runtime" });
  } catch {
    // Swallow analytics errors to avoid recursive crashes
  }
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[Main] unhandledRejection:", err);
  try {
    captureException(err, { process: "main", stage: "runtime", kind: "unhandledRejection" });
  } catch {
    // Swallow analytics errors to avoid recursive crashes
  }
});

// Start Electron's native Crashpad/Breakpad reporter as early as possible so it
// can catch crashes that happen during initialization (before app.whenReady).
startCrashReporter();

const remoteDebuggingPort = (
  process.env.SOLOMON_ELECTRON_REMOTE_DEBUGGING_PORT ??
  process.env.ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT
)?.trim();
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}

/** Append `feature` to an `enable-features`/`disable-features` switch, preserving any
 *  value already there — appendSwitch replaces rather than merges. */
function addChromiumFeature(switchName: "enable-features" | "disable-features", feature: string) {
  const existing = app.commandLine
    .getSwitchValue(switchName)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const features = new Set(existing);
  features.add(feature);
  app.commandLine.appendSwitch(switchName, Array.from(features).join(","));
}

if (process.platform === "darwin") {
  // Electron 39/Chromium can crash macOS mic capture in the audio utility process
  // with "Failed to initialize sandbox" before renderer audio reaches Whisper.
  // Keep renderer sandboxing on; only disable the narrower audio-service sandbox.
  addChromiumFeature("disable-features", "AudioServiceSandbox");

  // Without this, `audio: "loopback"` in setDisplayMediaRequestHandler silently
  // yields no audio track on macOS 15+ — meeting capture then hears only the mic,
  // never the other side of the call. Chromium moved system-audio loopback behind
  // this feature; Electron documents the switch as the supported way back in
  // (electron/electron#47493). Must be set before app.whenReady().
  addChromiumFeature("enable-features", "MacSckSystemAudioLoopbackOverride");
}

// run this as early in the main process as possible
if (started) app.quit();

// Single-instance lock: route a second launch (e.g. clicking a solomon-ai:// link)
// back into the existing process via the 'second-instance' event.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  console.error("[Main] Another Solomon AI instance is already running; exiting this process.");
  app.quit();
  process.exit(0);
}

// Register as the OS handler for our deep-link schemes.
//
// Not from an unpackaged build on macOS. setAsDefaultProtocolClient's `path`
// and `args` are Windows-only — macOS ignores them and registers whichever app
// bundle is running, which in dev is the bare Electron.app inside node_modules.
// That registration is both useless and destructive: useless because Electron
// launched without an app path just shows its welcome window, and destructive
// because it is a system-wide LaunchServices claim that outlives the dev
// process and steals the scheme from the user's installed app.
//
// The symptom is an OAuth reconnect that lands on Electron's welcome screen
// instead of completing, on a machine where someone once ran `npm run dev` —
// long after, and with nothing pointing back at the cause.
//
// Windows and Linux keep dev registration: there the path/args are honoured, so
// the OS can re-invoke the dev build correctly rather than hijacking anything.
const devOnMac = process.defaultApp && process.platform === "darwin";
if (!devOnMac) {
  for (const scheme of [DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME, OLDEST_DEEP_LINK_SCHEME]) {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
      }
    } else {
      app.setAsDefaultProtocolClient(scheme);
    }
  }
} else {
  console.log(
    "[Main] Dev build on macOS: not claiming deep-link schemes " +
      "(would steal them from the installed app). Deep links will open the installed app.",
  );
}

// First-launch URL on Windows/Linux comes through argv.
{
  const initialUrl = extractDeepLinkFromArgv(process.argv);
  if (initialUrl) dispatchUrl(initialUrl);
}

// macOS sends URLs via 'open-url' (both first launch and while running).
app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchUrl(url);
});

// Subsequent launches on Windows/Linux land here via the single-instance lock.
app.on("second-instance", (_event, argv) => {
  const url = extractDeepLinkFromArgv(argv);
  if (url) dispatchUrl(url);
});

console.log("preloadPath", preloadPath);

const rendererPath = app.isPackaged
  ? path.join(__dirname, "../renderer/dist") // Production
  : path.join(__dirname, "../../../renderer/dist"); // Development
const useBuiltRenderer =
  app.isPackaged || process.env.ROWBOAT_USE_BUILT_RENDERER === "true";
console.log("rendererPath", rendererPath);

// Register custom protocol for serving built renderer files in production
// AND for serving local workspace files to the renderer (images, PDFs, video).
//
//   app://workspace/<rel-path>  → workspace file (path-traversal guarded)
//   app://<anything-else>/...   → renderer SPA (existing behavior)
function registerAppProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);

    // Workspace files: app://workspace/<rel-path>
    if (url.host === "workspace") {
      try {
        const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        if (!relPath) return new Response("Not Found", { status: 404 });
        const absPath = resolveWorkspacePath(relPath);
        return net.fetch(pathToFileURL(absPath).toString());
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // Recorded meeting audio: app://recording/<sessionId>/<file>
    //
    // Its own host rather than reusing `workspace` because the recordings root is
    // configurable and may sit outside the workspace entirely — in which case
    // `app://workspace/recordings/...` silently 403s and click-to-play looks broken
    // for exactly the users who moved it somewhere deliberate.
    if (url.host === "recording") {
      return serveRecording(decodeURIComponent(url.pathname));
    }

    // Renderer SPA — existing logic
    let urlPath = url.pathname;
    if (urlPath === "/" || !path.extname(urlPath)) {
      urlPath = "/index.html";
    }

    const filePath = path.join(rendererPath, urlPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

/**
 * Serve one file out of one session directory, and nothing else.
 *
 * Two segments exactly, neither of which may traverse: the resolved path has to sit
 * directly inside the recordings root. This host can reach outside the workspace, so it
 * is the one place where a `..` would actually buy an attacker something.
 */
async function serveRecording(pathname: string): Promise<Response> {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return new Response("Not Found", { status: 404 });
  const [sessionId, file] = parts;
  if (!/^[\w.@-]+$/.test(sessionId) || !/^[\w.@-]+$/.test(file)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const config = await getTranscriptionConfig();
    const root = path.resolve(recordingsRoot(config.meetings?.recordingsDir));
    const absPath = path.resolve(root, sessionId, file);
    if (path.dirname(path.dirname(absPath)) !== root) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(absPath).toString());
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
      // Required for byte-range requests so <video> seeking works.
      stream: true,
    },
  },
]);

const ALLOWED_SESSION_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "clipboard-read",
  "clipboard-sanitized-write",
]);

function configureSessionPermissions(targetSession: Session): void {
  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_SESSION_PERMISSIONS.has(permission);
  });

  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_SESSION_PERMISSIONS.has(permission));
  });

  // Auto-approve display media requests and route system audio as loopback.
  // Electron requires a video source in the callback even if we only want audio.
  // We pass the first available screen source; the renderer discards the video track.
  targetSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    if (sources.length === 0) {
      callback({});
      return;
    }
    callback({ video: sources[0], audio: "loopback" });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // The three-pane workspace and its tab strip need a real desktop canvas.
    // Below this size controls truncate into ambiguous icon-only clusters.
    minWidth: 1024,
    minHeight: 640,
    show: false, // Don't show until ready
    backgroundColor: "#252525", // Prevent white flash (matches dark mode)
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    icon: process.platform !== "darwin" ? path.join(__dirname, "../../icons/icon.png") : undefined,
    webPreferences: {
      // IMPORTANT: keep Node out of renderer
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      // Enable Chromium's built-in PDFium plugin so <iframe src="*.pdf">
      // renders PDFs natively (zoom/scroll/print toolbar included).
      plugins: true,
    },
  });

  configureSessionPermissions(session.defaultSession);
  configureSessionPermissions(session.fromPartition(BROWSER_PARTITION));

  setMainWindow(win);
  setMainWindowForDeepLinks(win);
  win.on("closed", () => {
    setMainWindow(null);
    setMainWindowForDeepLinks(null);
  });
  win.webContents.on("preload-error", (_event, failedPreloadPath, error) => {
    console.error("[Main] preload failed:", failedPreloadPath, error);
  });

  // Show window when content is ready to prevent blank screen
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  // Open external links in system browser (not sandboxed Electron window)
  // This handles window.open() and target="_blank" links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Handle navigation to external URLs (e.g., clicking a link without target="_blank")
  win.webContents.on("will-navigate", (event, url) => {
    const isInternal = url.startsWith("app://") || url.startsWith("http://localhost:5173");
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Attach the embedded browser pane manager to this window.
  // The WebContentsView is created lazily on first `browser:setVisible`.
  browserViewManager.attach(win);

  if (useBuiltRenderer) {
    win.loadURL("app://-/index.html");
  } else {
    win.loadURL("http://localhost:5173");
  }

  return win;
}

async function startBackgroundServices() {
  // PostHog identify() is idempotent — call it on every startup so existing
  // signed-in installs (and every cold start of v0.3.4+) get re-identified.
  // Otherwise main-process events stay anonymous until the user re-signs-in.
  identifyIfSignedIn().catch((error) => {
    console.error("[Analytics] Failed to identify on startup:", error);
  });

  // Capture any minidumps left behind by a previous crashed launch.
  processPendingCrashDumps().catch((err) => {
    console.error("[CrashReporter] processPendingCrashDumps threw:", err);
  });

  // Start workspace watcher as a main-process service
  // Watcher runs independently and catches ALL filesystem changes:
  // - Changes made via IPC handlers (workspace:writeFile, etc.)
  // - External changes (terminal, git, other editors)
  // Only starts once (guarded in startWorkspaceWatcher)
  startWorkspaceWatcher();

  // start runs watcher
  startRunsWatcher();

  // start services watcher
  startServicesWatcher();

  // start live-note agent event watcher (forwards bus → renderer)
  startLiveNoteAgentWatcher();

  // start bg-task agent event watcher (forwards bus → renderer)
  startBackgroundTaskAgentWatcher();

  startMemoryWatcher();

  // start live-note scheduler (cron / window)
  initLiveNoteScheduler();

  // start bg-task scheduler (cron / window)
  initBackgroundTaskScheduler();

  // Meeting capture: put a menu-bar item up so a recording is visible and stoppable
  // with every window closed, and pick up any session that finished but never got
  // transcribed (a quit or crash mid-transcription costs a retry, not a meeting).
  initMeetingCapture();

  // RFC 006 offline-return: surface cloud runs that completed while the app
  // was closed (auto-pulls the newest successful artifact per task, gated by
  // the artifact-sync sidecar) and nudge the renderer with a quiet badge.
  checkOfflineReturn()
    .then(async (payload) => {
      if (!payload || payload.count === 0) return;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("bg-task:offlineRuns", payload);
        }
      }
      // Opt-in OS notification (RFC 006 decision: never default-on). Reuse
      // the GC-safe notification service; a body click focuses the window.
      const cfg = await getNotificationsConfig();
      if (cfg.cloudRunsOfflineNotify && notificationService.isSupported()) {
        notificationService.notify({
          message:
            payload.count === 1
              ? "1 cloud run completed while you were away"
              : `${payload.count} cloud runs completed while you were away`,
        });
      }
    })
    .catch((err) => {
      console.log(
        `offline-return check skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  // register event consumers and start the shared event processor
  // (consumes $WorkDir/events/pending/, routes events to all consumers
  // concurrently for Pass-1, then fires each consumer's candidates in parallel)
  registerConsumer(liveNoteEventConsumer);
  registerConsumer(backgroundTaskEventConsumer);
  initEventProcessor();

  // If the stored Google grant predates a scope change (only old scopes),
  // disconnect it now so the user re-connects with the current scopes before
  // any Google sync runs against the stale grant.
  await disconnectGoogleIfScopesStale();

  // Register the relationship-evidence observer BEFORE the loop starts, so the
  // first sync after launch is not silently skipped. It re-reads consent per
  // thread and is a no-op until the user turns email evidence on.
  initEmailRelationshipEvidence();

  // start gmail sync
  initGmailSync();

  // Attendance for meetings that were never recorded. Registered before the loop
  // for the same reason as the email observer.
  initCalendarAttendance();

  // start calendar sync
  initCalendarSync();

  // start fireflies sync
  initFirefliesSync();

  // start granola sync
  initGranolaSync();

  // start knowledge graph builder
  initGraphBuilder();

  // start semantic memory indexing service (RFC 021): keeps the local vector
  // index fresh so memory-search / ⌘K / related-notes have data to work with.
  initMemoryIndexing();

  // start email labeling service
  initEmailLabeling();

  // start note tagging service
  initNoteTagging();

  // start inline task service (@solomon: mentions)
  initInlineTasks();

  // start background agent runner (scheduled agents)
  initAgentRunner();

  // start agent notes learning service
  initAgentNotes();

  // start calendar meeting notification service (fires 1-minute warnings)
  initCalendarNotifications(calendarNotifyHooks());

  // start chrome extension sync server
  initChromeSync();

  // start local sites server for iframe dashboards and other mini apps
  initLocalSites().catch((error) => {
    console.error("[LocalSites] Failed to start:", error);
  });
}

app.whenReady().then(async () => {
  // Register custom protocol before creating window.
  // In production this serves the renderer SPA; in dev (and prod) it also
  // serves workspace files via app://workspace/<rel-path> for media previews.
  registerAppProtocol();

  // Auto-updater. initUpdates decides for itself whether an update path exists
  // (packaged, and a platform Squirrel serves) and reports "unsupported"
  // otherwise, so the renderer always has a status to render.
  initUpdates();

  // Initialize all config files before UI can access them
  await initConfigs();

  registerBrowserControlService(new ElectronBrowserControlService());
  registerNotificationService(notificationService);

  setupIpcHandlers();
  setupBrowserEventForwarding();

  // Listen for renderer/child-process crashes happening live.
  registerLiveCrashListeners();

  createWindow();
  initDesktopDictation();

  initializeExecutionEnvironment().catch((error) => {
    console.error("Failed to initialize execution environment:", error);
  });

  setTimeout(() => {
    startBackgroundServices().catch((error) => {
      console.error("[Main] Failed to start background services:", error);
    });
  }, 750);

  app.on("activate", () => {
    // `appWindows()` rather than `getAllWindows()`: the recording indicator must not
    // count, or clicking the dock during a meeting would find nothing to re-create.
    if (appWindows().length === 0) {
      createWindow();
    }
  });

  appFullyStarted = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Electron fires `window-all-closed` only when the *last* window closes, and the
// indicator is a window. Closing the app's window while it is up would otherwise leave
// the app running invisibly on Windows/Linux with no way back to it.
app.on("browser-window-created", (_event, win) => {
  win.on("closed", () => {
    if (process.platform === "darwin") return;
    if (appWindows().length === 0) app.quit();
  });
});

// ---------------------------------------------------------------------------
// Quit lifecycle (RFC 006 close-reminder)
// ---------------------------------------------------------------------------
//
// One handler owns before-quit: preventDefault() does NOT stop sibling
// listeners, so a separate reminder listener would let the cleanup below run
// even when the user picks "Keep Open", leaving a gutted live app.

let quitResolved = false; // this quit is allowed through → run cleanup
let reminderInFlight = false; // the reminder dialog is already showing
let appFullyStarted = false; // skips the early Squirrel/second-instance quits

// Auto-update restarts (Squirrel.Mac quitAndInstall) must never prompt.
// "before-quit-for-update" is a real app event but missing from the typings.
(app as unknown as NodeJS.EventEmitter).on("before-quit-for-update", () => {
  quitResolved = true;
});

app.on("before-quit", (event) => {
  if (quitResolved || !appFullyStarted) {
    runQuitCleanup();
    return;
  }
  // Synchronous, before any await: hold the quit while we decide.
  event.preventDefault();
  if (reminderInFlight) return;
  reminderInFlight = true;
  void maybeRemindThenQuit();
});

function proceedQuit(): void {
  quitResolved = true;
  app.quit(); // re-enters before-quit; the guard routes straight to cleanup
}

// hasPendingDesktopSchedules: the reminder applies only to ACTIVE desktop-
// target tasks with TIMED triggers — those genuinely pause when the app
// closes. api-target tasks run in the cloud regardless, and event-only tasks
// are out of the RFC's timed-schedule scope.
export function hasPendingDesktopSchedules(
  tasks: Array<{
    active: boolean;
    executionTarget?: string;
    triggers?: { cronExpr?: string; windows?: Array<unknown> } | null;
  }>,
): boolean {
  return tasks.some(
    (t) =>
      t.active &&
      (t.executionTarget ?? "desktop") === "desktop" &&
      !!t.triggers &&
      (!!t.triggers.cronExpr || (t.triggers.windows?.length ?? 0) > 0),
  );
}

async function maybeRemindThenQuit(): Promise<void> {
  try {
    const cfg = await getNotificationsConfig();
    if (!cfg.suppressDesktopScheduleQuitReminder) {
      const { items } = await listTasks({ limit: 1000 });
      if (hasPendingDesktopSchedules(items)) {
        const win = getMainWindow() ?? appWindows()[0];
        const opts: Electron.MessageBoxOptions = {
          type: "info",
          message: "Desktop schedules pause while the app is closed",
          detail:
            "Some of your scheduled tasks run on this device and only fire while the app " +
            "is open. Switch a task's execution target to API to keep it running in the cloud.",
          buttons: ["Quit", "Keep Open"],
          defaultId: 0,
          cancelId: 1,
          checkboxLabel: "Don't remind me again",
        };
        const result = win
          ? await dialog.showMessageBox(win, opts)
          : await dialog.showMessageBox(opts);
        if (result.checkboxChecked) {
          await setNotificationsConfig({ suppressDesktopScheduleQuitReminder: true });
        }
        if (result.response !== 0) {
          reminderInFlight = false;
          // Windows/Linux reach here via window-all-closed → quit; keeping
          // the app open with zero windows would strand it headless.
          if (appWindows().length === 0) {
            createWindow();
          }
          return;
        }
      }
    }
  } catch (err) {
    // Never block quitting on an error in the reminder path.
    console.error("[Main] quit reminder failed:", err);
  }
  proceedQuit();
}

function runQuitCleanup(): void {
  // Finalize a live meeting capture first: the sidecar patches its WAV headers on
  // SIGTERM, and everything else here can wait a few milliseconds for that.
  stopCaptureForQuit();
  destroyMeetingIndicator();
  destroyMeetingTray();
  destroyDesktopDictation();
  // Clean up watcher on app quit
  stopWorkspaceWatcher();
  stopRunsWatcher();
  stopServicesWatcher();
  // Tear down any live ACP coding-agent adapter processes so they don't outlive the app.
  try {
    container.resolve<CodeModeManager>("codeModeManager").disposeAll();
  } catch {
    // nothing live to dispose
  }
  shutdownLocalSites().catch((error) => {
    console.error("[LocalSites] Failed to shut down cleanly:", error);
  });
  shutdownAnalytics().catch((error) => {
    console.error("[Analytics] Failed to flush on quit:", error);
  });
}
