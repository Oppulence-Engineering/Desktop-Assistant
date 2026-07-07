import { API_URL } from "../config/env.js";
import { getAccessToken } from "./tokens.js";

/**
 * Client for the rowboat-api Slack workspace connect flow (RFC 003):
 *   GET  /oauth/slack/start      — browser-facing install front door; main
 *                                  opens it in the system browser. The api
 *                                  runs the OAuth v2 dance (it holds the
 *                                  client secret) and deep-links back to
 *                                  solomon-ai://oauth/slack/done?session=<state>.
 *   POST /v1/slack-oauth/claim   — one-shot redemption of the parked install:
 *                                  the api persists the workspace connection
 *                                  (team_id → user, the mapping its Slack
 *                                  events webhook resolves against) and
 *                                  returns workspace metadata only.
 *
 * The bot token never reaches the desktop — the server is the credential's
 * only consumer (cloud event routing) — so, like connector connects, there is
 * nothing to store locally on claim.
 */

/** Workspace metadata returned by a successful claim. */
export interface SlackWorkspaceConnection {
    connected: boolean;
    teamId: string;
    teamName?: string;
    scope?: string;
    botUserId?: string;
}

export interface SlackWorkspaceView {
    teamId: string;
    teamName?: string;
    scopes?: string[];
    connectedAt?: string;
}

export interface SlackWorkspacesResponse {
    workspaces: SlackWorkspaceView[];
}

export interface SlackThreadMessage {
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
}

export interface SlackThreadReadRequest {
    teamId: string;
    channel: string;
    threadTs: string;
    limit?: number;
}

export interface SlackThreadPostRequest {
    teamId: string;
    channel: string;
    threadTs: string;
    text: string;
}

export interface SlackThreadReadInput {
    teamId?: string;
    channel?: string;
    threadTs?: string;
    url?: string;
    limit?: number;
}

export interface SlackReplyDraftInput extends SlackThreadReadInput {
    text: string;
}

export interface SlackPermalinkTarget {
    teamId?: string;
    teamDomain?: string;
    channel: string;
    threadTs: string;
    messageTs?: string;
}

export interface SlackThreadReadResponse {
    teamId: string;
    channel: string;
    threadTs: string;
    messages: SlackThreadMessage[];
}

export interface SlackThreadPostResponse {
    ok: boolean;
    teamId: string;
    channel: string;
    threadTs: string;
}

export interface SlackReplyDraft {
    teamId: string;
    channel: string;
    threadTs: string;
    text: string;
    sent: false;
    requiresUserSend: true;
}

/** The browser URL that begins a Slack workspace install. */
export function slackStartURL(): string {
    return `${API_URL}/oauth/slack/start`;
}

function normalizeSlackURL(raw: string): string {
    let value = raw.trim();
    if (value.startsWith("<") && value.endsWith(">")) {
        value = value.slice(1, -1);
    }
    const labelSep = value.indexOf("|");
    if (labelSep >= 0) {
        value = value.slice(0, labelSep);
    }
    return value;
}

function timestampFromPermalinkID(value: string): string | undefined {
    const digits = value.replace(/^p/i, "");
    if (!/^\d+$/.test(digits) || digits.length < 10) return undefined;
    if (digits.length === 10) return digits;
    return `${digits.slice(0, 10)}.${digits.slice(10).padEnd(6, "0")}`;
}

function timestampFromSlackAppSegment(value: string): string | undefined {
    const match = value.match(/^[A-Z0-9]+-(\d+(?:\.\d+)?)$/i);
    return match?.[1];
}

export function parseSlackPermalink(rawURL: string): SlackPermalinkTarget | undefined {
    let url: URL;
    try {
        url = new URL(normalizeSlackURL(rawURL));
    } catch {
        return undefined;
    }

    const path = url.pathname.split("/").filter(Boolean);
    const threadTS = url.searchParams.get("thread_ts") || undefined;

    if (url.protocol === "slack:") {
        const channel = url.searchParams.get("id") || undefined;
        const teamId = url.searchParams.get("team") || undefined;
        const messageTS = url.searchParams.get("message") || undefined;
        const targetTS = threadTS || messageTS;
        if (channel && targetTS) {
            return { teamId, channel, threadTs: targetTS, messageTs: messageTS };
        }
    }

    const archivesIndex = path.indexOf("archives");
    if (archivesIndex >= 0 && path.length > archivesIndex + 2) {
        const channel = path[archivesIndex + 1];
        const messageTS = timestampFromPermalinkID(path[archivesIndex + 2]);
        if (channel && messageTS) {
            return {
                teamDomain: url.hostname.replace(/\.slack\.com$/i, ""),
                channel,
                threadTs: threadTS || messageTS,
                messageTs: messageTS,
            };
        }
    }

    if (url.hostname === "app.slack.com" && path[0] === "client" && path.length >= 3) {
        const teamId = path[1];
        const channel = path[2];
        const threadIndex = path.indexOf("thread");
        const messageTS =
            threadIndex >= 0 && path.length > threadIndex + 1
                ? timestampFromSlackAppSegment(path[threadIndex + 1])
                : url.searchParams.get("message") || undefined;
        const targetTS = threadTS || messageTS;
        if (teamId && channel && targetTS) {
            return { teamId, channel, threadTs: targetTS, messageTs: messageTS };
        }
    }

    return undefined;
}

export function buildSlackThreadReadRequest(
    input: SlackThreadReadInput,
    workspaces: SlackWorkspaceView[] = [],
): SlackThreadReadRequest {
    const parsed = input.url ? parseSlackPermalink(input.url) : undefined;
    if (input.url && !parsed) {
        throw new Error("Slack URL was not recognized. Use a Slack message permalink or pass teamId, channel, and threadTs.");
    }

    const teamId = input.teamId?.trim() || parsed?.teamId || (workspaces.length === 1 ? workspaces[0]?.teamId : undefined);
    const channel = input.channel?.trim() || parsed?.channel;
    const threadTs = input.threadTs?.trim() || parsed?.threadTs;

    if (!teamId) {
        if (workspaces.length === 0) {
            throw new Error("No Slack workspace is connected. Connect Slack in Connected Accounts first.");
        }
        throw new Error("More than one Slack workspace is connected. Pass the teamId from rowboat-list-slack-workspaces.");
    }
    if (!channel || !threadTs) {
        throw new Error("Slack thread target requires either a URL or both channel and threadTs.");
    }

    return { teamId, channel, threadTs, limit: input.limit };
}

export function buildSlackReplyDraft(input: SlackReplyDraftInput, workspaces: SlackWorkspaceView[] = []): SlackReplyDraft {
    const text = input.text.trim();
    if (!text) {
        throw new Error("Slack reply draft text is required.");
    }
    const target = buildSlackThreadReadRequest(input, workspaces);
    return {
        teamId: target.teamId,
        channel: target.channel,
        threadTs: target.threadTs,
        text,
        sent: false,
        requiresUserSend: true,
    };
}

/** Reads a human-readable message from an RFC 9457 problem+json error body. */
async function readError(res: Response): Promise<string> {
    try {
        const body = (await res.json()) as { detail?: string; title?: string; code?: string; error?: string };
        return body.detail ?? body.error ?? body.title ?? body.code ?? "";
    } catch {
        return "";
    }
}

/**
 * Redeem the Slack install parked under `state`. Throws on any non-200,
 * including the retryable 409 `install_incomplete` (claim raced ahead of the
 * browser callback — the deep link only fires after the callback parks the
 * bundle, so reaching that in practice means the flow was tampered with).
 */
export async function claimSlackWorkspaceViaBackend(state: string): Promise<SlackWorkspaceConnection> {
    const bearer = await getAccessToken();
    const res = await fetch(`${API_URL}/v1/slack-oauth/claim`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ session: state }),
    });
    if (!res.ok) {
        throw new Error(`slack claim failed: ${res.status} ${await readError(res)}`.trim());
    }
    return (await res.json()) as SlackWorkspaceConnection;
}

export async function listSlackWorkspacesViaBackend(): Promise<SlackWorkspacesResponse> {
    const bearer = await getAccessToken();
    const res = await fetch(`${API_URL}/v1/slack-oauth/workspaces`, {
        method: "GET",
        headers: {
            authorization: `Bearer ${bearer}`,
        },
    });
    if (!res.ok) {
        throw new Error(`slack workspace list failed: ${res.status} ${await readError(res)}`.trim());
    }
    return (await res.json()) as SlackWorkspacesResponse;
}

export async function deleteSlackWorkspaceViaBackend(teamId: string): Promise<void> {
    const bearer = await getAccessToken();
    const res = await fetch(`${API_URL}/v1/slack-oauth/workspaces/${encodeURIComponent(teamId)}`, {
        method: "DELETE",
        headers: {
            authorization: `Bearer ${bearer}`,
        },
    });
    if (!res.ok) {
        throw new Error(`slack workspace delete failed: ${res.status} ${await readError(res)}`.trim());
    }
}

export async function readSlackThreadViaBackend(input: SlackThreadReadRequest): Promise<SlackThreadReadResponse> {
    const bearer = await getAccessToken();
    const res = await fetch(`${API_URL}/v1/slack-oauth/thread/read`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        throw new Error(`slack thread read failed: ${res.status} ${await readError(res)}`.trim());
    }
    return (await res.json()) as SlackThreadReadResponse;
}

export async function postSlackThreadReplyViaBackend(input: SlackThreadPostRequest): Promise<SlackThreadPostResponse> {
    const bearer = await getAccessToken();
    const res = await fetch(`${API_URL}/v1/slack-oauth/thread/post`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        throw new Error(`slack thread post failed: ${res.status} ${await readError(res)}`.trim());
    }
    return (await res.json()) as SlackThreadPostResponse;
}
