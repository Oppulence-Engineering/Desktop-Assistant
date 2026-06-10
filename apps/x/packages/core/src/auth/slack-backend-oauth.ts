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

/** The browser URL that begins a Slack workspace install. */
export function slackStartURL(): string {
    return `${API_URL}/oauth/slack/start`;
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
