import { useEffect, useState } from "react";
import { ExternalLinkIcon, FileTextIcon, Loader2Icon } from "@/lib/icons";

interface PdfFileViewerProps {
  path: string;
}

type State = "loading" | "ready" | "error";

export function PdfFileViewer({ path }: PdfFileViewerProps) {
  const [state, setState] = useState<State>("loading");

  // The iframe onError event does not fire for app:// 404s, so precheck the
  // file exists via workspace:stat (mirrors HtmlFileViewer); a missing/renamed
  // PDF then shows the error/fallback instead of a blank frame. (ERRORS.md E26)
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const stat = await window.ipc.invoke("workspace:stat", { path });
        if (cancelled) return;
        if (stat.kind !== "file") setState("error");
      } catch {
        if (cancelled) return;
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const src = `app://workspace/${path.split("/").map(encodeURIComponent).join("/")}`;

  if (state === "error") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileTextIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot preview this PDF</p>
        <button
          type="button"
          onClick={() => {
            void window.ipc.invoke("shell:openPath", { path });
          }}
          className="inline-flex items-center gap-1.5 rounded-none border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in system
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <iframe
        key={path}
        src={src}
        className="h-full w-full border-0 bg-white"
        title="PDF preview"
        onLoad={() => setState("ready")}
        onError={() => setState("error")}
      />
      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Loading PDF…</p>
        </div>
      )}
    </div>
  );
}
