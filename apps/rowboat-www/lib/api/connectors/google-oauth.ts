import { StartGoogleOAuth200Response } from "@/lib/api/generated/zod/google-oauth/google-oauth";
import { dashboardFetch } from "@/lib/auth/client";
import { safeAuthorizationURL } from "@/lib/connectors/hosted-oauth";

const GOOGLE_COMMITMENTS_OAUTH_START =
  "/api/rowboat/v1/google-oauth/start?profile=commitments&return=web";

/**
 * Creates a web Google authorization URL for commitment evidence.
 *
 * The explicit web return mode is required because the same API also serves
 * desktop OAuth. Without it, a browser grant can return to the desktop deep
 * link and never be claimed by the web session.
 */
export async function createGoogleCommitmentsAuthorizationURL(): Promise<URL> {
  const response = await dashboardFetch(GOOGLE_COMMITMENTS_OAUTH_START, {
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
