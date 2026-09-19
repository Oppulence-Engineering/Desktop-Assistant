export const googleOauthKeys = {
  all: ["google-oauth"] as const,
  status: () => [...googleOauthKeys.all, "status"] as const,
};

export const GOOGLE_OAUTH_STATUS_STALE_TIME = 15_000;
