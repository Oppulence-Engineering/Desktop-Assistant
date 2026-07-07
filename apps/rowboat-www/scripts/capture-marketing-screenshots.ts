#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "../..");
const desktopDir = path.join(repoRoot, "apps/x");
const desktopMainDir = path.join(desktopDir, "apps/main");
const electronBin = path.join(desktopMainDir, "node_modules/.bin/electron");

const workspaceDir =
  process.env.ROWBOAT_WWW_SCREENSHOT_WORKSPACE_DIR ||
  path.join(repoRoot, ".rowboat-kind/marketing-screenshots/workspace");
const apiDb =
  process.env.ROWBOAT_WWW_SCREENSHOT_API_DB ||
  process.env.ROWBOAT_API_DATABASE_URL ||
  process.env.DATABASE_URL ||
  path.join(repoRoot, "apps/rowboat-api/rowboat-dev.db");
const outputDir =
  process.env.ROWBOAT_WWW_SCREENSHOT_OUTPUT_DIR ||
  path.join(appDir, "public/marketing");
const apiUrl = trimTrailingSlash(
  process.env.ROWBOAT_WWW_SCREENSHOT_API_URL || "http://localhost:18080",
);
const devstackUrl = trimTrailingSlash(
  process.env.ROWBOAT_WWW_SCREENSHOT_DEVSTACK_URL || "http://localhost:18090",
);
const vitePort = process.env.ROWBOAT_WWW_SCREENSHOT_VITE_PORT || "5173";
const cdpPort = process.env.ROWBOAT_WWW_SCREENSHOT_CDP_PORT || "9233";
const keepDesktop = process.env.ROWBOAT_WWW_SCREENSHOT_KEEP_DESKTOP === "1";
const reuseVite = process.env.ROWBOAT_WWW_SCREENSHOT_REUSE_VITE === "1";
const artifactDir =
  process.env.ROWBOAT_WWW_SCREENSHOT_ARTIFACT_DIR ||
  path.join(repoRoot, ".rowboat-kind/marketing-screenshots");
const logFile = path.join(artifactDir, "desktop.log");

type NavCapture = {
  file: string;
  label: string;
  waitText: string;
};

const navCaptures: NavCapture[] = [
  { file: "desktop-home.png", label: "Home", waitText: "Home" },
  { file: "desktop-email.png", label: "Email", waitText: "Email" },
  { file: "desktop-meetings.png", label: "Meetings", waitText: "Meetings" },
  { file: "desktop-knowledge.png", label: "Knowledge", waitText: "Knowledge" },
  {
    file: "desktop-background-tasks.png",
    label: "Background tasks",
    waitText: "Background tasks",
  },
];

async function main() {
  need("npm");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  if (reuseVite) {
    await requireHttp(`http://localhost:${vitePort}`, "desktop renderer");
  } else {
    await assertPortFree(vitePort, "desktop renderer");
  }
  await assertPortFree(cdpPort, "Electron CDP");
  run("npm", ["run", "deps"], { cwd: desktopDir });

  seedWorkspace();
  await writeDevstackAuth();

  const log = fs.openSync(logFile, "w");
  const desktopEnv = getDesktopEnv();
  const desktopProcesses: ChildProcess[] = [];
  const startDesktopProcess = (command: string, args: string[], cwd: string) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env: desktopEnv,
      stdio: ["ignore", log, log],
    });
    desktopProcesses.push(child);
    return child;
  };

  if (!reuseVite) {
    startDesktopProcess("npm", ["run", "renderer"], desktopDir);
    await waitForHttp(`http://localhost:${vitePort}`, "desktop renderer");
  }
  run("npm", ["run", "build"], { cwd: desktopMainDir, env: desktopEnv });
  startDesktopProcess(electronBin, [`--remote-debugging-port=${cdpPort}`, "."], desktopMainDir);

  let cleanupDone = false;
  let cdp: CdpClient | undefined;
  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try {
      cdp?.close();
    } catch {
      // The CDP socket may already be closed.
    }
    if (!keepDesktop) {
      for (const child of desktopProcesses.slice().reverse()) {
        stopProcess(child);
      }
    }
    try {
      fs.closeSync(log);
    } catch {
      // The log fd may already be closed during process shutdown.
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    await waitForCdp();
    cdp = await CdpClient.connect(cdpPort);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.bringToFront");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await completeOnboardingIfNeeded(cdp);

    for (const capture of navCaptures) {
      console.log(`capturing ${capture.file}`);
      if (capture.label !== "Home") {
        await clickButton(cdp, capture.label);
      }
      await waitForText(cdp, capture.waitText);
      await dismissTransientToasts(cdp);
      await captureScreenshot(cdp, capture.file);
    }

    console.log("capturing desktop-chat.png");
    await clickButton(cdp, "Home");
    await waitForText(cdp, "Home");
    await fillText(cdp, 'textarea[name="message"]', "Brief me on Acme before I reply to Maya");
    await waitForText(cdp, "Brief me on Acme");
    await sleep(750);
    await dismissTransientToasts(cdp);
    await captureScreenshot(cdp, "desktop-chat.png");

    console.log("capturing desktop-connections.png");
    await clickButton(cdp, "Connect Accounts");
    await waitForText(cdp, "Connect Accounts");
    await dismissTransientToasts(cdp);
    await captureScreenshot(cdp, "desktop-connections.png");

    console.log(`marketing screenshots refreshed in ${outputDir}`);
    console.log(`desktop log: ${logFile}`);
  } catch (error) {
    if (cdp) {
      const textFile = path.join(artifactDir, "last-screen.txt");
      try {
        fs.writeFileSync(textFile, `${await getBodyText(cdp)}\n`, "utf8");
        console.error(`wrote debug body text: ${textFile}`);
      } catch (debugError) {
        console.error(`could not write debug body text: ${debugError instanceof Error ? debugError.message : String(debugError)}`);
      }
      try {
        await captureDebugScreenshot(cdp);
      } catch (debugError) {
        console.error(`could not capture debug screenshot: ${debugError instanceof Error ? debugError.message : String(debugError)}`);
      }
    }
    throw error;
  } finally {
    cleanup();
  }
}

function seedWorkspace() {
  run("npm", [
    "run",
    "seed:demo",
    "--",
    "--workspace-dir",
    workspaceDir,
    "--api-db",
    apiDb,
  ], {
    cwd: appDir,
  });
}

async function writeDevstackAuth() {
  await requireHttp(`${apiUrl}/healthz`, "rowboat-api health");
  const tokenResponse = await fetch(
    `${devstackUrl}/mint?workos_user_id=user_marketing_screenshots&email=marketing-screenshots%40oppulence.io`,
  );
  if (!tokenResponse.ok) {
    throw new Error(
      `could not mint devstack token from ${devstackUrl}: ${tokenResponse.status} ${tokenResponse.statusText}`,
    );
  }
  const tokenJson = (await tokenResponse.json()) as { token?: string };
  if (!tokenJson.token) {
    throw new Error(`devstack token response did not include token`);
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 3300;
  const configDir = path.join(workspaceDir, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "oauth.json"),
    `${JSON.stringify(
      {
        version: 2,
        providers: {
          solomon: {
            mode: "solomon",
            tokens: {
              access_token: tokenJson.token,
              refresh_token: null,
              expires_at: expiresAt,
              token_type: "Bearer",
            },
          },
          rowboat: {
            mode: "rowboat",
            tokens: {
              access_token: tokenJson.token,
              refresh_token: null,
              expires_at: expiresAt,
              token_type: "Bearer",
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function completeOnboardingIfNeeded(cdp: CdpClient) {
  await sleep(500);
  const bodyText = await getBodyText(cdp);
  if (bodyText.includes("workspace that remembers.")) {
    await clickButton(cdp, "Continue with");
    await waitForText(cdp, "Sources");
    await clickButton(cdp, "Skip source connections for now");
    await waitForText(cdp, "Setup summary");
    await clickButton(cdp, "Start Using");
  }
  await waitForText(cdp, "Home");
}

async function clickButton(cdp: CdpClient, label: string) {
  await evaluate(cdp, `
(() => {
  const label = ${JSON.stringify(label)};
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const labelMatches = (candidate) => {
    const text = normalize(candidate.innerText || candidate.textContent);
    const aria = normalize(candidate.getAttribute?.('aria-label'));
    return text.includes(label) || aria.includes(label);
  };
  const direct = [...document.querySelectorAll('button, [role="button"], a')].find(labelMatches);
  const nested = [...document.querySelectorAll('body *')].find((candidate) => {
    if (!labelMatches(candidate)) return false;
    return Boolean(candidate.closest('button, [role="button"], a'));
  });
  const button = direct || nested?.closest('button, [role="button"], a');
  if (!button) {
    throw new Error('button not found: ' + label);
  }
  button.click();
  return true;
})()
`);
  await sleep(500);
}

async function waitForText(cdp: CdpClient, text: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await getBodyText(cdp)).includes(text)) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for text: ${text}`);
}

async function fillText(cdp: CdpClient, selector: string, value: string) {
  await evaluate(cdp, `
(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  if (!input) {
    throw new Error('input not found: ${selector}');
  }
  input.focus();
  return true;
})()
`);
  await cdp.send("Input.insertText", { text: value });
}

async function getBodyText(cdp: CdpClient) {
  return evaluate<string>(cdp, "document.body?.innerText || ''");
}

async function dismissTransientToasts(cdp: CdpClient) {
  await evaluate(cdp, `
(() => {
  const errorPattern = /failed|error|unauthorized|toolkit/i;
  for (const element of document.querySelectorAll('[data-sonner-toast], [role="status"]')) {
    if (errorPattern.test(element.textContent || '')) {
      element.remove();
    }
  }
  return true;
})()
`);
}

async function captureScreenshot(cdp: CdpClient, file: string) {
  const target = path.join(outputDir, file);
  await writeScreenshot(cdp, target);
  console.log(`captured ${path.relative(repoRoot, target)}`);
}

async function captureDebugScreenshot(cdp: CdpClient) {
  const target = path.join(artifactDir, "desktop-debug.png");
  await writeScreenshot(cdp, target);
  console.error(`captured ${target}`);
}

async function writeScreenshot(cdp: CdpClient, target: string) {
  const result = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(target, result.data, "base64");
}

async function waitForCdp() {
  const url = `http://127.0.0.1:${cdpPort}/json/version`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until Electron exposes the CDP endpoint.
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for Electron CDP on ${url}; see ${logFile}`);
}

async function assertPortFree(port: string, label: string) {
  for (const host of ["127.0.0.1", "localhost"]) {
    try {
      await fetch(`http://${host}:${port}`, { signal: AbortSignal.timeout(1000) });
      throw new Error(`${label} port ${port} is already in use; stop the existing process first`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already in use")) {
        throw error;
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`${label} port ${port} is already in use but did not return HTTP`);
      }
    }
  }
}

async function waitForHttp(url: string, label: string, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the service accepts connections.
    }
    await sleep(1000);
  }
  throw new Error(`${label} did not become ready before timeout (${url})`);
}

async function requireHttp(url: string, label: string) {
  try {
    const response = await fetch(url);
    if (response.ok) return;
    throw new Error(`${response.status} ${response.statusText}`);
  } catch (error) {
    throw new Error(
      `${label} is required before screenshots can be captured (${url}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function getDesktopEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    API_URL: apiUrl,
    SOLOMON_WORKDIR: workspaceDir,
    ROWBOAT_WORKDIR: workspaceDir,
    SOLOMON_ELECTRON_REMOTE_DEBUGGING_PORT: cdpPort,
    ROWBOAT_ELECTRON_REMOTE_DEBUGGING_PORT: cdpPort,
  };
}

function need(command: string) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(`missing required command: ${command}`);
  }
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function stopProcess(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
    return;
  } catch {
    // Fall back to direct child termination below.
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may already have exited.
  }
}

type CdpMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: {
    message: string;
    data?: string;
  };
};

type CdpTarget = {
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
};

type RuntimeEvaluateResult<T> = {
  result?: {
    value?: T;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
    };
  };
};

class CdpClient {
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private constructor(private readonly ws: WebSocket) {
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ""}`));
        return;
      }
      pending.resolve(message.result);
    });
  }

  static async connect(port: string) {
    if (typeof WebSocket === "undefined") {
      throw new Error("Node.js WebSocket support is required for CDP screenshots");
    }
    const target = await getCdpTarget(port);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out connecting to ${target.webSocketDebuggerUrl}`)), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`could not connect to ${target.webSocketDebuggerUrl}`));
      }, { once: true });
    });
    return new CdpClient(ws);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("CDP connection closed"));
      this.pending.delete(id);
    }
    this.ws.close();
  }
}

async function getCdpTarget(port: string): Promise<Required<Pick<CdpTarget, "webSocketDebuggerUrl">> & CdpTarget> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`could not list Electron CDP targets: ${response.status} ${response.statusText}`);
  }
  const targets = (await response.json()) as CdpTarget[];
  const page =
    targets.find((target) => target.type === "page" && target.url?.includes(`:${vitePort}`) && target.webSocketDebuggerUrl) ||
    targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ||
    targets.find((target) => target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`Electron CDP did not expose a page target on port ${port}`);
  }
  console.log(`connected to CDP target: ${page.title || "(untitled)"} ${page.url || ""}`);
  return page as Required<Pick<CdpTarget, "webSocketDebuggerUrl">> & CdpTarget;
}

async function evaluate<T>(cdp: CdpClient, expression: string, timeoutMs = 30_000): Promise<T> {
  const result = await cdp.send<RuntimeEvaluateResult<T>>(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        `CDP Runtime.evaluate failed: ${expression}`,
    );
  }
  return result.result?.value as T;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
