import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/**
 * Constructs the Gmail API client, honouring a devstack override.
 *
 * Every Gmail call in this package goes through here so that local dogfooding
 * can be pointed at the devstack mock (see apps/rowboat-api/cmd/devstack/gmail.go)
 * instead of a real mailbox. Before this existed, exercising mail sync,
 * classification, or embedding generation locally meant connecting a real Google
 * account and syncing real mail — so the mutating paths (archive, mark-read,
 * trash, send) were effectively untestable, because the only way to run them was
 * against mail someone cared about.
 *
 * ROWBOAT_GMAIL_ROOT_URL is read per call rather than cached at module load: the
 * main process sets it from the kind script at launch, and a stale cached value
 * silently sending dogfood traffic to real Gmail is the one failure this must
 * not have.
 */
export function createGmailClient(auth: OAuth2Client): gmail_v1.Gmail {
  const rootUrl = gmailRootUrl();
  return google.gmail(rootUrl ? { version: "v1", auth, rootUrl } : { version: "v1", auth });
}

/**
 * The override origin, or undefined when talking to real Gmail.
 *
 * googleapis appends the service path to rootUrl, so it must carry a trailing
 * slash; without one the last path segment is dropped and every request 404s.
 * Only loopback is accepted — this variable redirects a user's mailbox traffic,
 * and an arbitrary host here would turn a stray environment variable into silent
 * exfiltration of mail contents and OAuth bearer tokens.
 */
function gmailRootUrl(): string | undefined {
  const raw = process.env.ROWBOAT_GMAIL_ROOT_URL?.trim();
  if (!raw) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.warn(`[Gmail] ignoring unparseable ROWBOAT_GMAIL_ROOT_URL: ${raw}`);
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.warn(`[Gmail] ignoring ROWBOAT_GMAIL_ROOT_URL with protocol ${parsed.protocol}`);
    return undefined;
  }
  if (!isLoopback(parsed.hostname)) {
    console.warn(
      `[Gmail] refusing ROWBOAT_GMAIL_ROOT_URL host ${parsed.hostname}; only loopback is allowed`,
    );
    return undefined;
  }
  return parsed.origin + "/";
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
