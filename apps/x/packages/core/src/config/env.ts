const PRODUCTION_API_URL = "https://api.oppulence.io";
const RETIRED_API_URLS = new Set(["https://api.x.solomon-ai.co"]);

function resolveApiUrl(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized || RETIRED_API_URLS.has(normalized)) {
    return PRODUCTION_API_URL;
  }
  return normalized;
}

export const API_URL = resolveApiUrl(process.env.API_URL);
