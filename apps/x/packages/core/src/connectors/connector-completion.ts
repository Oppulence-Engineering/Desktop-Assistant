export interface ConnectorCompletion {
  connector: string;
  status: string;
  state: string;
}

/** Parse the code-only connector completion URI accepted by the desktop. */
export function parseConnectorCompletion(url: string): ConnectorCompletion | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "solomon-ai:" || parsed.hostname !== "connection-complete") return null;
  const connector = parsed.searchParams.get("connector");
  const state = parsed.searchParams.get("session");
  if (!connector || !state) return null;
  return { connector, status: parsed.searchParams.get("status") ?? "", state };
}
