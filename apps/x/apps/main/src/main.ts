import { app, BrowserWindow, desktopCapturer, protocol, net, shell, session, type Session } from "electron";
import path from "node:path";
import {
  setupIpcHandlers,
  startRunsWatcher,
  startServicesWatcher,
  startLiveNoteAgentWatcher,
  startBackgroundTaskAgentWatcher,
  startWorkspaceWatcher,
  stopRunsWatcher,
  stopServicesWatcher,
  stopWorkspaceWatcher
} from "./ipc.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
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
import { backgroundTaskEventConsumer } from "@x/core/dist/background-tasks/event-consumer.js";
import { init as initLocalSites, shutdown as shutdownLocalSites } from "@x/core/dist/local-sites/server.js";
import { shutdown as shutdownAnalytics, captureException } from "@x/core/dist/analytics/posthog.js";
import { identifyIfSignedIn } from "@x/core/dist/analytics/identify.js";

import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import { resolveWorkspacePath } from "@x/core/dist/workspace/workspace.js";
import started from "electron-squirrel-startup";
import { init as initChromeSync } from "@x/core/dist/knowledge/chrome-extension/server/server.js";
import { registerBrowserControlService, registerNotificationService } from "@x/core/dist/di/container.js";
import { browserViewManager, BROWSER_PARTITION } from "./browser/view.js";
import { setupBrowserEventForwarding } from "./browser/ipc.js";
import { ElectronBrowserControlService } from "./browser/control-service.js";
import { ElectronNotificationService } from "./notification/electron-notification-service.js";
import {
  DEEP_LINK_SCHEME,
  LEGACY_DEEP_LINK_SCHEME,
  dispatchUrl,
  extractDeepLinkFromArgv,
  setMainWindowForDeepLinks,
} from "./deeplink.js";
import { startCrashReporter, processPendingCrashDumps, registerLiveCrashListeners } from "./crash-reporter.js";
import { initializeExecutionEnvironment } from "./execution-environment.js";
import { disconnectGoogleIfScopesStale } from "./oauth-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Capture uncaught exceptions and unhandled promise rejections in the main
// process and forward them to PostHog. This must be registered as early as
// possible so we don't miss errors thrown during startup. The handlers swallow
// errors from the analytics path itself to avoid recursive crashes.
process.on('uncaughtException', (err) => {
  console.error('[Main] uncaughtException:', err);
  try {
    captureException(err, { process: 'main', stage: 'runtime' });
  } catch {
    // Swallow analytics errors to avoid recursive crashes
  }
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[Main] unhandledRejection:', err);
  try {
    captureException(err, { process: 'main', stage: 'runtime', kind: 'unhandledRejection' });
  } catch {
    // Swallow analytics errors to avoid recursive crashes
  }
});

// Start Electron's native Crashpad/Breakpad reporter as early as possible so it
// can catch crashes that happen during initialization (before app.whenReady).
startCrashReporter();

const remoteDebuggingPort = (
  process.env.SOLOMON_ELECTRON_REMOTE_DEBUGGING_PORT
  ?? process.env.ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT
)?.trim();
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
}

// run this as early in the main process as possible
if (started) app.quit();

// Single-instance lock: route a second launch (e.g. clicking a solomon-ai:// link)
// back into the existing process via the 'second-instance' event.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  console.error('[Main] Another Solomon AI instance is already running; exiting this process.');
  app.quit();
  process.exit(0);
}

// Register as the OS handler for solomon-ai:// URLs.
// In dev, point at the right argv so the OS can re-invoke us correctly.
for (const scheme of [DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME]) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(scheme);
  }
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

// Path resolution differs between development and production:
const preloadPath = app.isPackaged
  ? path.join(__dirname, "../preload/dist/preload.js")
  : path.join(__dirname, "../../../preload/dist/preload.js");
console.log("preloadPath", preloadPath);

const rendererPath = app.isPackaged
  ? path.join(__dirname, "../renderer/dist") // Production
  : path.join(__dirname, "../../../renderer/dist"); // Development
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

    // Renderer SPA — existing logic
    let urlPath = url.pathname;
    if (urlPath === "/" || !path.extname(urlPath)) {
      urlPath = "/index.html";
    }

    const filePath = path.join(rendererPath, urlPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
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

const ALLOWED_SESSION_PERMISSIONS = new Set(["media", "display-capture", "clipboard-read", "clipboard-sanitized-write"]);

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
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (sources.length === 0) {
      callback({});
      return;
    }
    callback({ video: sources[0], audio: 'loopback' });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 480,
    show: false, // Don't show until ready
    backgroundColor: "#252525", // Prevent white flash (matches dark mode)
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
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

  setMainWindowForDeepLinks(win);
  win.on("closed", () => setMainWindowForDeepLinks(null));

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
    const isInternal =
      url.startsWith("app://") || url.startsWith("http://localhost:5173");
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Attach the embedded browser pane manager to this window.
  // The WebContentsView is created lazily on first `browser:setVisible`.
  browserViewManager.attach(win);

  if (app.isPackaged) {
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
    console.error('[Analytics] Failed to identify on startup:', error);
  });

  // Capture any minidumps left behind by a previous crashed launch.
  processPendingCrashDumps().catch((err) => {
    console.error('[CrashReporter] processPendingCrashDumps threw:', err);
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

  // start live-note scheduler (cron / window)
  initLiveNoteScheduler();

  // start bg-task scheduler (cron / window)
  initBackgroundTaskScheduler();

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

  // start gmail sync
  initGmailSync();

  // start calendar sync
  initCalendarSync();

  // start fireflies sync
  initFirefliesSync();

  // start granola sync
  initGranolaSync();

  // start knowledge graph builder
  initGraphBuilder();

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
  initCalendarNotifications();

  // start chrome extension sync server
  initChromeSync();

  // start local sites server for iframe dashboards and other mini apps
  initLocalSites().catch((error) => {
    console.error('[LocalSites] Failed to start:', error);
  });
}

app.whenReady().then(async () => {
  // Register custom protocol before creating window.
  // In production this serves the renderer SPA; in dev (and prod) it also
  // serves workspace files via app://workspace/<rel-path> for media previews.
  registerAppProtocol();

  // Initialize auto-updater (only in production)
  if (app.isPackaged) {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "Oppulence-Engineering/Desktop-Assistant",
      },
      notifyUser: true, // Shows native dialog when update is available
    });
  }

  // Initialize all config files before UI can access them
  await initConfigs();

  registerBrowserControlService(new ElectronBrowserControlService());
  registerNotificationService(new ElectronNotificationService());

  setupIpcHandlers();
  setupBrowserEventForwarding();

  // Listen for renderer/child-process crashes happening live.
  registerLiveCrashListeners();

  createWindow();

  initializeExecutionEnvironment().catch((error) => {
    console.error('Failed to initialize execution environment:', error);
  });

  setTimeout(() => {
    startBackgroundServices().catch((error) => {
      console.error('[Main] Failed to start background services:', error);
    });
  }, 750);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Clean up watcher on app quit
  stopWorkspaceWatcher();
  stopRunsWatcher();
  stopServicesWatcher();
  shutdownLocalSites().catch((error) => {
    console.error('[LocalSites] Failed to shut down cleanly:', error);
  });
  shutdownAnalytics().catch((error) => {
    console.error('[Analytics] Failed to flush on quit:', error);
  });
});
