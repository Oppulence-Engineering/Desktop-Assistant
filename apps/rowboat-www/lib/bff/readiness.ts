import "server-only";

const ROWBOAT_API_READINESS_TIMEOUT_MS = 2_000;

export async function isRowboatApiReady(apiBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/readyz", `${apiBaseUrl}/`), {
      cache: "no-store",
      signal: AbortSignal.timeout(ROWBOAT_API_READINESS_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
