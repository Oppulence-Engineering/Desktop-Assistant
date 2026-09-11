import { z } from "zod";

/**
 * Desktop sign-in hand-off.
 *
 * WorkOS only redirects to redirect URIs registered in its dashboard, and the
 * desktop app's loopback URI (http://127.0.0.1:PORT/oauth/callback) is not one
 * of them: requesting it directly bounces the user to
 * error.workos.com/redirect-uri-invalid, so desktop sign-in can never complete.
 *
 * Rather than register a loopback URI (which WorkOS's dashboard is the only way
 * to do, and which would have to be re-registered for every port), the desktop
 * reuses the web callback that is already registered and encodes its loopback
 * port in the OAuth `state`. The web callback recognises that state and bounces
 * the authorization code back to the app.
 *
 * The web tier never sees the PKCE verifier: it stays in the desktop app, which
 * performs the code exchange itself. This route is a pure redirect, so a
 * hijacked bounce yields a code that cannot be exchanged without the verifier.
 */
const DESKTOP_STATE_PREFIX = "desktop";

/**
 * Ports the desktop app is allowed to receive a code on. This is a fixed
 * allowlist rather than any caller-supplied port so the callback cannot be
 * turned into an open redirect (the destination is always loopback, but an
 * arbitrary port would still let a local process farm authorization codes).
 * Keep in sync with `oauthCallbackUrl` in the desktop distribution manifests.
 */
const ALLOWED_DESKTOP_PORTS = new Set([5198]);

const DESKTOP_CALLBACK_PATH = "/oauth/callback";

const DesktopStateSchema = z
  .string()
  .regex(
    new RegExp(`^${DESKTOP_STATE_PREFIX}\\.(\\d{2,5})\\.[A-Za-z0-9_-]{16,128}$`),
    "not a desktop sign-in state",
  );

/**
 * Builds the `state` a desktop client sends to WorkOS. `nonce` must stay
 * unguessable: the desktop matches it on return to reject codes it did not ask
 * for.
 */
export function buildDesktopState(port: number, nonce: string): string {
  return `${DESKTOP_STATE_PREFIX}.${port}.${nonce}`;
}

/**
 * Returns the desktop loopback URL to bounce an authorization code to, or null
 * when this is an ordinary web sign-in (the overwhelmingly common case) or when
 * the state names a port we do not hand codes to.
 */
export function desktopCallbackTarget(state: string | null, code: string): URL | null {
  if (!state?.startsWith(`${DESKTOP_STATE_PREFIX}.`)) return null;

  const parsed = DesktopStateSchema.safeParse(state);
  if (!parsed.success) return null;

  const port = Number(parsed.data.split(".")[1]);
  if (!ALLOWED_DESKTOP_PORTS.has(port)) return null;

  const target = new URL(`http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  return target;
}

/** Exported for tests and for the desktop manifest to assert against. */
export const DESKTOP_SIGN_IN = {
  prefix: DESKTOP_STATE_PREFIX,
  allowedPorts: ALLOWED_DESKTOP_PORTS,
  callbackPath: DESKTOP_CALLBACK_PATH,
} as const;
