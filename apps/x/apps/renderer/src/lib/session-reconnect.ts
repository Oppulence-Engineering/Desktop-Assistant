export type SessionReconnectState = {
  isLoading: boolean;
  signedIn: boolean;
  authReason: "not_signed_in" | "reconnect_required" | "refresh_backoff" | null;
  billingErrorReason: "auth_unavailable" | "unknown" | null;
  deferred: boolean;
};

export function shouldShowSessionReconnect({
  isLoading,
  signedIn,
  authReason,
  billingErrorReason,
  deferred,
}: SessionReconnectState): boolean {
  if (deferred || isLoading || !signedIn) return false;
  return authReason === "reconnect_required" || billingErrorReason === "auth_unavailable";
}
