import container from "../di/container.js";
import { RefreshController, AuthState } from "./refresh-controller.js";
import { IOAuthRepo } from "./repo.js";
import { refreshWorkosTokens } from "./workos-backend.js";

// WorkOS is confidential — refresh is brokered server-side by the API (which
// holds the API key). See workos-backend.ts / AUTH.md. All refresh policy
// (single-flight, backoff, reconnect-required persistence) lives in the
// controller; this module just owns the process-wide singleton.
const controller = new RefreshController({
  repo: () => container.resolve<IOAuthRepo>("oauthRepo"),
  refresh: refreshWorkosTokens,
});

/**
 * Returns a usable bearer for the product API, refreshing if needed.
 * Throws AuthUnavailableError (see refresh-errors.ts) when auth is down:
 * not signed in, reconnect required, or refresh in a backoff window —
 * callers should treat those as "quiesce", not "retry now".
 */
export async function getAccessToken(): Promise<string> {
  return controller.getAccessToken();
}

/** Current refresh state — background schedulers consult this to skip ticks. */
export function getAuthState(): AuthState {
  return controller.getState();
}
