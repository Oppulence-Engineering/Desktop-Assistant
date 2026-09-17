import { StartGoogleOAuth200Response } from "@/lib/api/generated/zod/google-oauth/google-oauth";
import { dashboardFetch } from "@/lib/auth/client";
import { safeAuthorizationURL } from "@/lib/connectors/hosted-oauth";

const GOOGLE_COMMITMENTS_OAUTH_START = "/api/rowboat/v1/google-oauth/start";
const GOOGLE_CONNECTIONS_PATH = "/app/settings?settings=connections";

export type GoogleOAuthReturnPath = "/app/report" | typeof GOOGLE_CONNECTIONS_PATH;

/**
 * Creates a web Google authorization URL for commitment evidence.
 *
 * The explicit web return mode is required because the same API also serves
 * desktop OAuth. Without it, a browser grant can return to the desktop deep
 * link and never be claimed by the web session.
 */
export async function createGoogleCommitmentsAuthorizationURL(
  returnPath: GoogleOAuthReturnPath = GOOGLE_CONNECTIONS_PATH,
): Promise<URL> {
  const query = new URLSearchParams({
    profile: "commitments",
    return: "web",
    return_path: returnPath,
  });
  const response = await dashboardFetch(`${GOOGLE_COMMITMENTS_OAUTH_START}?${query.toString()}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Could not start Google authorization (${String(response.status)})`);
  }

  const data = StartGoogleOAuth200Response.parse(await response.json());
  const authorizationURL = safeAuthorizationURL(data.authorizeUrl);
  if (!authorizationURL) {
    throw new Error("Google returned an invalid authorization URL");
  }
  return authorizationURL;
}
