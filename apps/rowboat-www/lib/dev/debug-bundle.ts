import { getBffFetchLog } from "@/lib/dev/bff-fetch-log";
import { getDevPrefs } from "@/lib/dev/dev-prefs";

export type DebugBundle = {
  capturedAt: string;
  pathname: string;
  search: string;
  prefs: ReturnType<typeof getDevPrefs>;
  recentBffCalls: ReturnType<typeof getBffFetchLog>;
};

export function buildDebugBundle(): DebugBundle {
  return {
    capturedAt: new Date().toISOString(),
    pathname: typeof window !== "undefined" ? window.location.pathname : "",
    search: typeof window !== "undefined" ? window.location.search : "",
    prefs: getDevPrefs(),
    recentBffCalls: getBffFetchLog().slice(0, 10),
  };
}

export async function copyDebugBundleToClipboard(): Promise<void> {
  const bundle = buildDebugBundle();
  const text = JSON.stringify(bundle, null, 2);
  await navigator.clipboard.writeText(text);
  console.info("[dev-toolkit] debug bundle copied", bundle);
}
