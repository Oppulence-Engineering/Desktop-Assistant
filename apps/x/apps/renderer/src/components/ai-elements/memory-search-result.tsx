import { useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@oppulence/ui/components/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, BrainIcon } from "@/lib/icons";
import { useFileCard } from "@/contexts/file-card-context";
import { splitWikiFragment } from "@/lib/wiki-links";

// Shape of the `memory-search` tool result (RFC 021); kept loose since it arrives
// as a parsed object from the run stream.
interface MemoryHit {
  path: string;
  headingAnchor: string;
  backlink: string;
  snippet: string;
  score: number;
  highlights?: { start: number; end: number }[];
  startLine: number;
  endLine: number;
}
interface MemoryResult {
  mode?: string;
  count?: number;
  results?: MemoryHit[];
}

/** Render a snippet with the matched spans bolded (offsets index into `snippet`). */
function renderSnippet(snippet: string, highlights?: { start: number; end: number }[]): ReactNode {
  if (!highlights || highlights.length === 0) return snippet;
  const out: ReactNode[] = [];
  let pos = 0;
  for (const h of highlights) {
    if (h.start < pos || h.start > snippet.length) continue;
    if (h.start > pos) out.push(snippet.slice(pos, h.start));
    out.push(
      <mark key={`${h.start}-${h.end}`} className="bg-transparent font-semibold text-foreground">
        {snippet.slice(h.start, h.end)}
      </mark>,
    );
    pos = h.end;
  }
  if (pos < snippet.length) out.push(snippet.slice(pos));
  return out;
}

function noteTitle(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

/** memory paths are knowledge-relative; navigation expects WorkDir-relative. */
function toNavPath(p: string): string {
  return p.startsWith("knowledge/") ? p : `knowledge/${p}`;
}

/**
 * "Sources" card for the copilot's `memory-search` tool call (RFC 021): renders the
 * retrieved chunks as clickable rows (snippet + relevance) that open the source note,
 * instead of the default opaque JSON tool output.
 */
export function MemorySearchSources({
  result,
  status,
}: {
  result: unknown;
  status: "pending" | "running" | "completed" | "error";
}) {
  const [open, setOpen] = useState(true);
  const { onOpenKnowledgeFile } = useFileCard();
  const hits = (result as MemoryResult | undefined)?.results ?? [];
  const running = status === "pending" || status === "running";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="not-prose mb-4 w-full rounded-[28px] border bg-[var(--card-surface)] transition-colors duration-150 ease-out hover:border-foreground/30"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-left text-sm font-medium">
          <BrainIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {running ? "Searching memory…" : `Memory · ${hits.length} source${hits.length === 1 ? "" : "s"}`}
          </span>
        </span>
        <ChevronDownIcon
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[collapsible-down_0.09s_ease-out] data-[state=closed]:animate-[collapsible-up_0.08s_ease-in]">
        <div className="px-4 pb-3">
          {hits.length > 0 ? (
            <div className="max-h-72 overflow-y-auto rounded-none border">
              {hits.map((hit, index) => (
                <button
                  type="button"
                  key={`${hit.path}-${hit.startLine}-${index}`}
                  onClick={() => onOpenKnowledgeFile(toNavPath(splitWikiFragment(hit.backlink).path || hit.path))}
                  className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{noteTitle(hit.path)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {hit.score.toFixed(2)}
                    </span>
                  </div>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {renderSnippet(hit.snippet, hit.highlights)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{running ? "…" : "No matches in memory."}</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
