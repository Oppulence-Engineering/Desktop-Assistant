/** Enable React Scan options after the unpkg auto bundle attaches. */
export async function applyReactScanDevOptions(trackUnnecessaryRenders: boolean): Promise<void> {
  if (typeof window === "undefined") return;

  const globalScan = (window as Window & { __REACT_SCAN__?: { setOptions?: (o: object) => void } })
    .__REACT_SCAN__;
  if (globalScan?.setOptions) {
    globalScan.setOptions({ trackUnnecessaryRenders, showToolbar: true });
    return;
  }

  try {
    const { setOptions } = await import("react-scan");
    setOptions({ trackUnnecessaryRenders, showToolbar: true });
  } catch {
    // auto.global.js may not be loaded yet on marketing-only pages
  }
}
