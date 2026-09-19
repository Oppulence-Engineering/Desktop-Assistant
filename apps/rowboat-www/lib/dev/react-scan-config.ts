type ReactScanRuntime = {
  setOptions?: (options: { enabled?: boolean; showToolbar?: boolean }) => void;
};

/**
 * Enable React Scan after the unpkg auto bundle attaches.
 *
 * `trackUnnecessaryRenders` is still listed on the published Options type,
 * but `validateOptions` treats it as unknown (deprecated and never re-enabled).
 * The toolkit pref keeps that storage key and now maps to `enabled`.
 */
export async function applyReactScanDevOptions(scanEnabled: boolean): Promise<void> {
  if (typeof window === "undefined") return;

  const options = { enabled: scanEnabled, showToolbar: true };
  const globalScan = (window as Window & { __REACT_SCAN__?: ReactScanRuntime }).__REACT_SCAN__;
  if (globalScan?.setOptions) {
    globalScan.setOptions(options);
    return;
  }

  try {
    const { setOptions } = await import("react-scan");
    setOptions(options);
  } catch {
    // auto.global.js may not be loaded yet on marketing-only pages
  }
}
