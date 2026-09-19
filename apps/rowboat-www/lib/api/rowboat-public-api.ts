const PUBLIC_API_BASE_ENV_KEYS = [
  "ROWBOAT_WWW_PUBLIC_API_BASE_URL",
  "ROWBOATX_PUBLIC_API_BASE_URL",
  "ROWBOAT_WWW_API_PROXY_URL",
  "ROWBOATX_API_PROXY_URL",
  "ROWBOATX_API_BASE_URL",
];

export function publicRowboatApiURL(pathname: string): URL {
  return new URL(pathname, publicRowboatApiBaseURL());
}

export function publicRowboatApiBaseURL(): URL {
  const base =
    PUBLIC_API_BASE_ENV_KEYS.map((key) => process.env[key]?.trim()).find(Boolean) ??
    "https://api.oppulence.io";

  return new URL(`${base.replace(/\/+$/, "")}/`);
}
