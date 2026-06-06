import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/dist/config/config.js";
import { DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME } from "@x/shared/dist/branding.js";

export { DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEME };
const URL_PREFIXES = [`${DEEP_LINK_SCHEME}://`, `${LEGACY_DEEP_LINK_SCHEME}://`];
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
    if (parseAction(url)) {
        void dispatchAction(url);
    } else if (parseOAuthCompletion(url)) {
        void dispatchOAuthCompletion(url);
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

    win.webContents.send("app:openUrl", { url });
    pendingUrl = null;
}

interface MeetingNotesAction {
    type: "take-meeting-notes" | "join-and-take-meeting-notes";
    eventId: string;
}

type ParsedAction = MeetingNotesAction;

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
    return null;
}

async function dispatchAction(url: string): Promise<void> {
    const parsed = parseAction(url);
    if (!parsed) return;

    const openMeeting = parsed.type === "join-and-take-meeting-notes";
    await handleTakeMeetingNotes(parsed.eventId, openMeeting);
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
            win.webContents.send("app:takeMeetingNotes", payload);
        });
        return;
    }

    win.webContents.send("app:takeMeetingNotes", payload);
}

// --- OAuth completion (Solomon AI-managed Google connect) ---

interface OAuthCompletion {
    provider: "google";
    state: string;
}

/**
 * Match solomon-ai://oauth/google/done?session=<state>. Returns null for
 * anything else — including paths with the right shape but wrong provider
 * or a missing `session` query param.
 */
function parseOAuthCompletion(url: string): OAuthCompletion | null {
    const rest = getDeepLinkPayload(url);
    if (rest === null) return null;
    const queryIdx = rest.indexOf("?");
    const path = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest;
    const parts = path.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "oauth" || parts[2] !== "done") return null;
    if (parts[1] !== "google") return null;
    const params = new URLSearchParams(queryIdx >= 0 ? rest.slice(queryIdx + 1) : "");
    const state = params.get("session");
    return state ? { provider: "google", state } : null;
}

async function dispatchOAuthCompletion(url: string): Promise<void> {
    const parsed = parseOAuthCompletion(url);
    if (!parsed) return;

    // Bring the app to the front so the renderer can react to the
    // oauthEvent IPC that completeSolomonGoogleConnect emits.
    const win = mainWindowRef;
    if (win && !win.isDestroyed()) focusWindow(win);

    // Lazy-import to keep deeplink.ts free of OAuth deps and avoid a
    // potential circular dep with oauth-handler.ts.
    const { completeSolomonGoogleConnect } = await import("./oauth-handler.js");
    await completeSolomonGoogleConnect(parsed.state);
}

function focusWindow(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}
