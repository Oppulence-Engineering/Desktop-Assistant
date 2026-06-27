import { useEffect, useState, type JSX } from "react";
import { HtmlFileViewer } from "./html-file-viewer";
import { PdfFileViewer } from "./pdf-file-viewer";
import { getViewerType, isCacheableViewerPath } from "@/lib/file-types";

const CACHE_LIMIT = 3;

function renderViewer(path: string): JSX.Element | null {
  const type = getViewerType(path);
  if (type === "html") return <HtmlFileViewer path={path} />;
  if (type === "pdf") return <PdfFileViewer path={path} />;
  return null;
}

interface PersistentViewerCacheProps {
  activePath: string;
  /**
   * Paths still open as tabs. When provided, cached viewers for paths no longer
   * in this set are unmounted (instead of lingering until the size cap evicts
   * them), so closing/renaming a tab frees its iframe. (ERRORS.md E27)
   */
  livePaths?: string[];
}

/**
 * Keeps recently-opened HTML and PDF viewers mounted in the DOM,
 * toggling visibility instead of unmounting. This preserves iframe
 * state (PDF page/zoom, HTML scroll/JS state) across file switches.
 */
export function PersistentViewerCache({ activePath, livePaths }: PersistentViewerCacheProps) {
  const [mountedPaths, setMountedPaths] = useState<string[]>(() =>
    isCacheableViewerPath(activePath) ? [activePath] : [],
  );

  useEffect(() => {
    if (!isCacheableViewerPath(activePath)) return;
    setMountedPaths((prev) => {
      // Never reorder existing entries — moving a keyed iframe in the DOM
      // detaches it, which causes the browser to re-navigate (state lost).
      if (prev.includes(activePath)) return prev;
      const next = [...prev, activePath];
      return next.length > CACHE_LIMIT ? next.slice(-CACHE_LIMIT) : next;
    });
  }, [activePath]);

  // Drop cached viewers whose tab is no longer open (close/rename). Filtering
  // preserves order, so surviving iframes are not detached/re-navigated. (ERRORS.md E27)
  useEffect(() => {
    if (!livePaths) return;
    const live = new Set(livePaths);
    setMountedPaths((prev) => {
      const next = prev.filter((p) => live.has(p) || p === activePath);
      return next.length === prev.length ? prev : next;
    });
  }, [livePaths, activePath]);

  return (
    <div className="relative h-full w-full">
      {mountedPaths.map((p) => (
        <div
          key={p}
          className="absolute inset-0"
          style={{ display: p === activePath ? "block" : "none" }}
        >
          {renderViewer(p)}
        </div>
      ))}
    </div>
  );
}
