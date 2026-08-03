const AUTH_ERROR_PATTERN =
  /AuthUnavailableError|invalid_grant|session expired|token expired|not signed in|not signed into|sign in again/i;
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*/i;

export function userFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = message.trim();

  if (!trimmed) return fallback;
  if (AUTH_ERROR_PATTERN.test(trimmed)) {
    return "Your Oppulence session expired. Sign in again to continue.";
  }

  // Electron decorates rejected IPC calls with the channel name and internal error
  // details. Those details are useful in logs, but they are not actionable UI copy.
  if (IPC_ERROR_PREFIX.test(trimmed)) return fallback;

  return trimmed;
}
