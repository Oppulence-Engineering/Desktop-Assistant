import { useEffect, useState } from "react";
import { X, BrainIcon, Loader2 } from "@/lib/icons";

// memory:related takes a knowledge-relative path; the editor/nav use WorkDir-relative.
const toIndexPath = (p: string): string => p.replace(/^knowledge\//, "");
const toNavPath = (p: string): string => (p.startsWith("knowledge/") ? p : `knowledge/${p}`);
const title = (p: string): string => (p.split("/").pop() ?? p).replace(/\.md$/i, "");

export interface RelatedNotesSidebarProps {
  /** WorkDir-relative path of the open note (`knowledge/Foo.md`); `null` hides the panel. */
  filePath: string | null;
  /** Open a related note (WorkDir-relative path). */
  onOpen: (path: string) => void;
  onClose: () => void;
}

/**
 * Right-rail panel listing notes semantically related to the open note (RFC 021),
 * via the `memory:related` IPC. Click a row to open it. Mirrors the live-note panel.
 */
export function RelatedNotesSidebar({ filePath, onOpen, onClose }: RelatedNotesSidebarProps) {
  const [related, setRelated] = useState<{ path: string; score: number }[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setRelated(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.ipc
      .invoke("memory:related", { path: toIndexPath(filePath), k: 12 })
      .then((res) => {
        if (!cancelled) setRelated(res.related);
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (!filePath) return null;

  return (
    <aside className="flex w-[340px] max-w-[32vw] shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <BrainIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">Related notes</span>
        <button
          type="button"
          className="ml-auto inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Finding related notes…
          </div>
        ) : related && related.length > 0 ? (
          <ul className="py-1">
            {related.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  onClick={() => onOpen(toNavPath(r.path))}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-accent"
                  title={r.path}
                >
                  <span className="truncate">{title(r.path)}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.score.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No related notes yet.
            <span className="mt-1 block text-xs">The semantic index builds in the background.</span>
          </div>
        )}
      </div>
    </aside>
  );
}
