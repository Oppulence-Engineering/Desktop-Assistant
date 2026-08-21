const DEFAULT_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export const MACOS_SYSTEM_SETTINGS_PROTOCOLS = new Set(["x-apple.systempreferences:"]);

export function validateExternalUrl(
  rawUrl: string,
  allowedProtocols: ReadonlySet<string> = DEFAULT_EXTERNAL_PROTOCOLS,
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Cannot open an invalid external URL");
  }
  if (!allowedProtocols.has(url.protocol)) {
    throw new Error(`External URL protocol '${url.protocol}' is not allowed`);
  }
  return url.toString();
}
