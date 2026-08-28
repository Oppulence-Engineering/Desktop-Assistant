import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/config/config";
import { parseConnectorCompletion } from "@x/core/connectors/connector-completion";
import type { MeetingCalendarEvent } from "@x/shared/meetings";
import { normalizeMeetingEvent } from "@x/shared/meetings";
import { parseMcpApprovalDeepLink, registerMcpApprovalResult } from "@x/core/mcp/product-approval";
import { peekMeetingController } from "./meeting-controller.js";
import { sendRendererEvent } from "./renderer-events.js";
import {
  DEEP_LINK_SCHEME,
  LEGACY_DEEP_LINK_SCHEME,
  OLDEST_DEEP_LINK_SCHEME,
} from "@x/shared/branding";

export { DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME, OLDEST_DEEP_LINK_SCHEME };
const URL_PREFIXES = [
  `${DEEP_LINK_SCHEME}://`,
  `${LEGACY_DEEP_LINK_SCHEME}://`,
  `${OLDEST_DEEP_LINK_SCHEME}://`,
];
const ACTION_HOST = "action";

let pendingUrl: string | null = null;
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindowForDeepLinks(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function consumePendingDeepLink(): string | null {
  const url = pendingUrl;
  pendingUrl = null;
  return url;
}

export function extractDeepLinkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && getDeepLinkPayload(arg) !== null) return arg;
  }
  return null;
}

function getDeepLinkPayload(url: string): string | null {
  for (const prefix of URL_PREFIXES) {
    if (url.startsWith(prefix)) return url.slice(prefix.length);
  }
  return null;
}

/**
 * Dispatch any solomon-ai:// URL — chooses among action / oauth-completion /
 * navigation automatically. Use this from notification click handlers and
 * other URL entry points.
 *
 * OAuth completion (solomon-ai://oauth/google/done?session=<state>) is handled
 * in main, not the renderer, because claiming tokens writes oauth.json and
 * triggers sync — both main-process concerns.
 */
export function dispatchUrl(url: string): void {
  const approval = parseMcpApprovalDeepLink(url);
  if (approval) {
    registerMcpApprovalResult(approval);
    const win = mainWindowRef;
    if (win && !win.isDestroyed()) focusWindow(win);
  } else if (parseAction(url)) {
    void dispatchAction(url);
  } else if (parseOAuthCompletion(url)) {
    void dispatchOAuthCompletion(url);
  } else if (parseConnectorCompletion(url)) {
    void dispatchConnectorCompletion(url);
  } else {
    dispatchDeepLink(url);
  }
}

export function dispatchDeepLink(url: string): void {
  if (getDeepLinkPayload(url) === null) return;

  pendingUrl = url;

  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;
  focusWindow(win);

  if (win.webContents.isLoading()) return;

  sendRendererEvent(win.webContents, "app:openUrl", { url });
  pendingUrl = null;
}

interface MeetingNotesAction {
  type: "take-meeting-notes" | "join-and-take-meeting-notes";
  eventId: string;
}

/** Start a native recording for a calendar event. Deliberately handled in main rather
 *  than forwarded to the renderer: capture no longer belongs to a window, and this must
 *  work with every window closed. */
interface RecordMeetingAction {
  type: "record-meeting";
  eventId: string;
}

/** Open the app on the meetings surface — where a readiness problem is explained. */
interface MeetingSetupAction {
  type: "meeting-setup";
}

type ParsedAction = MeetingNotesAction | RecordMeetingAction | MeetingSetupAction;

function parseAction(url: string): ParsedAction | null {
  const rest = getDeepLinkPayload(url);
  if (rest === null) return null;
  const queryIdx = rest.indexOf("?");
  const host = (queryIdx >= 0 ? rest.slice(0, queryIdx) : rest).replace(/\/$/, "");
  if (host !== ACTION_HOST) return null;
  const params = new URLSearchParams(queryIdx >= 0 ? rest.slice(queryIdx + 1) : "");
  const type = params.get("type");
  if (type === "take-meeting-notes" || type === "join-and-take-meeting-notes") {
    const eventId = params.get("eventId");
    return eventId ? { type, eventId } : null;
  }
  if (type === "record-meeting") {
    const eventId = params.get("eventId");
    return eventId ? { type, eventId } : null;
  }
  if (type === "meeting-setup") return { type };
  return null;
}

async function dispatchAction(url: string): Promise<void> {
  const parsed = parseAction(url);
  if (!parsed) return;

  if (parsed.type === "record-meeting") {
    await handleRecordMeeting(parsed.eventId);
    return;
  }
  if (parsed.type === "meeting-setup") {
    const win = mainWindowRef;
    if (win && !win.isDestroyed()) focusWindow(win);
    return;
  }

  const openMeeting = parsed.type === "join-and-take-meeting-notes";
  await handleTakeMeetingNotes(parsed.eventId, openMeeting);
}

/**
 * Start recording for an event, without needing a window.
 *
 * The click that gets here may be the user's only interaction with the app all day —
 * the main window can be closed and the notification still has to work, which is the
 * whole reason capture moved into the main process.
 */
async function handleRecordMeeting(eventId: string): Promise<void> {
  const controller = peekMeetingController();
  if (!controller) {
    console.warn("[deeplink] record-meeting: capture is not available");
    return;
  }
  if (controller.recording) return;
  // Standing by for this meeting already: promote, keeping the buffered minutes. Calling
  // `start` here would discard them and begin from the click, which is the one outcome
  // standby exists to avoid.
  if (controller.standingBy) {
    const promoted = await controller.beginRecording();
    if (!promoted.started) {
      console.error(`[deeplink] record-meeting: ${promoted.error ?? "could not promote"}`);
    }
    return;
  }

  let event: MeetingCalendarEvent | undefined;
  try {
    const raw = await fs.readFile(path.join(WorkDir, "calendar_sync", `${eventId}.json`), "utf-8");
    // Narrow rather than cast. calendar_sync holds the entire raw provider event,
    // so the previous cast persisted the description, attachments and recurrence
    // rules into the session's meta.json under a type that claimed none of them.
    event = normalizeMeetingEvent(JSON.parse(raw), {
      fallbackId: eventId,
      calendarId: "primary",
      source: "google",
    });
  } catch (err) {
    // Start anyway: a recording with no calendar context still beats no recording.
    console.warn(`[deeplink] record-meeting: could not read event ${eventId}`, err);
  }

  const result = await controller.start(event);
  if (!result.started) {
    console.error(`[deeplink] record-meeting: ${result.error ?? "could not start"}`);
  }
}

async function handleTakeMeetingNotes(eventId: string, openMeeting: boolean): Promise<void> {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;
  focusWindow(win);

  const filePath = path.join(WorkDir, "calendar_sync", `${eventId}.json`);
  let event: unknown;
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    event = JSON.parse(raw);
  } catch (err) {
    console.error(`[deeplink] take-meeting-notes: failed to read ${filePath}`, err);
    return;
  }

  const payload = { event, openMeeting };

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      sendRendererEvent(win.webContents, "app:takeMeetingNotes", payload);
    });
    return;
  }

  sendRendererEvent(win.webContents, "app:takeMeetingNotes", payload);
}

// --- OAuth completion (Solomon AI-managed Google / Slack connects) ---

interface OAuthCompletion {
  provider: "google" | "slack";
  state: string;
  status: string;
}

/**
 * Match solomon-ai://oauth/{google|slack}/done?session=<state>[&status=...].
 * Returns null for anything else — including paths with the right shape but
 * an unknown provider or a missing `session` query param.
 */
function parseOAuthCompletion(url: string): OAuthCompletion | null {
  const rest = getDeepLinkPayload(url);
  if (rest === null) return null;
  const queryIdx = rest.indexOf("?");
  const path = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest;
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "oauth" || parts[2] !== "done") return null;
  if (parts[1] !== "google" && parts[1] !== "slack") return null;
  const params = new URLSearchParams(queryIdx >= 0 ? rest.slice(queryIdx + 1) : "");
  const state = params.get("session");
  if (!state) return null;
  return { provider: parts[1], state, status: params.get("status") ?? "" };
}

async function dispatchOAuthCompletion(url: string): Promise<void> {
  const parsed = parseOAuthCompletion(url);
  if (!parsed) return;

  // Bring the app to the front so the renderer can react to the
  // oauthEvent IPC that the claim emits.
  const win = mainWindowRef;
  if (win && !win.isDestroyed()) focusWindow(win);

  // The api deep-links status=error when the browser flow failed; surface it
  // without claiming. (Google's callback predates the status param and omits
  // it on success, so only an explicit "error" short-circuits.)
  if (parsed.status === "error") {
    const { emitOAuthEvent } = await import("./ipc.js");
    emitOAuthEvent({ provider: parsed.provider, success: false, error: "connection failed" });
    return;
  }

  // Lazy-import to keep deeplink.ts free of OAuth deps and avoid a
  // potential circular dep with oauth-handler.ts.
  if (parsed.provider === "slack") {
    const { completeSolomonSlackConnect } = await import("./oauth-handler.js");
    await completeSolomonSlackConnect(parsed.state);
    return;
  }
  const { completeSolomonGoogleConnect } = await import("./oauth-handler.js");
  await completeSolomonGoogleConnect(parsed.state);
}

// --- Connector completion (rowboat-api connector OAuth broker) ---

async function dispatchConnectorCompletion(url: string): Promise<void> {
  const parsed = parseConnectorCompletion(url);
  if (!parsed) return;

  // Bring the app to the front so the renderer reacts to the oauth event the
  // claim emits (connector connections reuse the oauth:didConnect channel,
  // keyed by the connector name).
  const win = mainWindowRef;
  if (win && !win.isDestroyed()) focusWindow(win);

  if (parsed.status !== "success") {
    // The browser flow reported an error/expiry; surface it without claiming.
    const { emitOAuthEvent } = await import("./ipc.js");
    emitOAuthEvent({ provider: parsed.connector, success: false, error: "connection failed" });
    return;
  }

  // Lazy-import to avoid a circular dep with oauth-handler.ts (which imports
  // emitOAuthEvent from ipc.ts).
  const { completeConnectorConnect } = await import("./oauth-handler.js");
  await completeConnectorConnect(parsed.connector, parsed.state);
}

function focusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
