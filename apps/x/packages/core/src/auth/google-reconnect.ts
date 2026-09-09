/**
 * A reconnect has landed only when the credential on disk differs from the one
 * that existed before the browser flow started. Merely finding an access token
 * is not enough because reconnects intentionally begin with a stale token.
 */
export function hasGoogleCredentialChanged(
  previousAccessToken: string | null,
  currentAccessToken: string | null | undefined,
): boolean {
  return Boolean(currentAccessToken && currentAccessToken !== previousAccessToken);
}
