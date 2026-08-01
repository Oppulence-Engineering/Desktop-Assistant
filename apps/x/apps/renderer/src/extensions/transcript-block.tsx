import { mergeAttributes, Node } from "@tiptap/react";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { ChevronDown, FileText, Play } from "@/lib/icons";
import { blocks } from "@x/shared";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

interface TranscriptEntry {
  speaker: string;
  text: string;
  startMs?: number;
  track?: "mic" | "system";
}

interface AudioTrack {
  track: "mic" | "system";
  url: string;
  offsetMs: number;
  durationMs: number;
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function parseTranscript(raw: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match **Speaker Name:** text or **You:** text
    const match = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (match) {
      entries.push({ speaker: match[1], text: match[2] });
    } else if (entries.length > 0) {
      // Continuation line — append to last entry
      entries[entries.length - 1].text += " " + trimmed;
    }
  }
  return entries;
}

function speakerColor(speaker: string): string {
  // Simple hash to pick a consistent color per speaker
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) {
    hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "#3b82f6", // blue
    "#06b6d4", // cyan
    "#6366f1", // indigo
    "#8b5cf6", // purple
    "#0ea5e9", // sky
    "#2563eb", // blue darker
    "#7c3aed", // violet
  ];
  return colors[Math.abs(hash) % colors.length];
}

function TranscriptBlockView({
  node,
  getPos,
  editor,
}: {
  node: { attrs: Record<string, unknown> };
  getPos: () => number | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
}) {
  const raw = node.attrs.data as string;
  let config: blocks.TranscriptBlock | null = null;

  try {
    config = blocks.TranscriptBlockSchema.parse(JSON.parse(raw));
  } catch {
    // fallback below
  }

  // Auto-detect: expand if this is the first real block (live recording),
  // collapse if there's other content above (notes have been generated)
  const isFirstBlock = useMemo(() => {
    try {
      const pos = getPos();
      if (pos === undefined) return false;
      const firstChild = editor?.state?.doc?.firstChild;
      if (!firstChild) return true;
      // If the transcript block is right after the first node (heading), it's the main content
      return pos <= (firstChild.nodeSize ?? 0) + 1;
    } catch {
      return false;
    }
  }, [getPos, editor]);

  const [expanded, setExpanded] = useState(isFirstBlock);

  // Prefer the timed segments when the capture engine wrote them; fall back to parsing
  // the rendered text, which is all an older note (or a hand-edited one) has.
  const entries = useMemo<TranscriptEntry[]>(() => {
    if (!config) return [];
    if (config.segments?.length) {
      return config.segments.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
        startMs: segment.start_ms,
        track: segment.track,
      }));
    }
    return parseTranscript(config.transcript);
  }, [config]);

  const sessionId = config?.sessionId;
  const [audio, setAudio] = useState<{ tracks: AudioTrack[]; reason?: string } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  // Only asked once the block is open and only when there are timings to seek with —
  // a collapsed transcript should not go looking for audio.
  useEffect(() => {
    if (!expanded || !sessionId || audio) return;
    let cancelled = false;
    void window.ipc
      .invoke("meeting:audioTracks", { sessionId })
      .then((result) => {
        if (!cancelled) setAudio(result);
      })
      .catch(() => {
        if (!cancelled) setAudio({ tracks: [], reason: "this recording could not be opened" });
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, sessionId, audio]);

  const playFrom = useCallback(
    (index: number, entry: TranscriptEntry) => {
      if (entry.startMs === undefined || !audio?.tracks.length) return;
      const wanted = entry.track ?? "system";
      const chosen = audio.tracks.find((t) => t.track === wanted) ?? audio.tracks[0];
      const element = player.current;
      if (!element) return;
      // Transcript times are on the shared session clock; each file begins at its own
      // offset. Without this subtraction a click lands seconds off the line.
      const seekSeconds = Math.max(0, (entry.startMs - chosen.offsetMs) / 1000);
      if (element.src !== chosen.url) {
        element.src = chosen.url;
        // `src` assignment is async — seek once there is something to seek in.
        element.addEventListener(
          "loadedmetadata",
          () => {
            element.currentTime = seekSeconds;
            void element.play();
          },
          { once: true },
        );
        element.load();
      } else {
        element.currentTime = seekSeconds;
        void element.play();
      }
      setPlaying(index);
    },
    [audio],
  );

  if (!config) {
    return (
      <NodeViewWrapper className="transcript-block-wrapper" data-type="transcript-block">
        <div className="transcript-block-card transcript-block-error">
          <FileText size={16} />
          <span>Invalid transcript block</span>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="transcript-block-wrapper" data-type="transcript-block">
      <div className="transcript-block-card" onMouseDown={(e) => e.stopPropagation()}>
        <button
          className="transcript-block-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ChevronDown
            size={14}
            className={`transcript-block-chevron ${expanded ? "transcript-block-chevron-open" : ""}`}
          />
          <FileText size={14} />
          <span>Raw transcript</span>
        </button>
        {expanded && (
          <div className="transcript-block-content">
            {audio?.reason && entries.some((e) => e.startMs !== undefined) && (
              // Said plainly rather than leaving dead lines: audio is deleted after
              // transcription by default, so "no audio" is the normal case and not a bug.
              <div className="transcript-audio-note">{audio.reason}</div>
            )}
            <audio ref={player} onEnded={() => setPlaying(null)} preload="none" hidden />
            {entries.length > 0 ? (
              entries.map((entry, i) => {
                const seekable = entry.startMs !== undefined && (audio?.tracks.length ?? 0) > 0;
                return (
                  <div
                    key={i}
                    className={`transcript-entry${seekable ? " transcript-entry-seekable" : ""}${playing === i ? " transcript-entry-playing" : ""}`}
                    onClick={seekable ? () => playFrom(i, entry) : undefined}
                    role={seekable ? "button" : undefined}
                    tabIndex={seekable ? 0 : undefined}
                    onKeyDown={
                      seekable
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              playFrom(i, entry);
                            }
                          }
                        : undefined
                    }
                    title={seekable ? "Play from here" : undefined}
                  >
                    {entry.startMs !== undefined && (
                      <span className="transcript-time">
                        {seekable && <Play size={9} className="transcript-play" />}
                        {clockLabel(entry.startMs)}
                      </span>
                    )}
                    <span
                      className="transcript-speaker"
                      style={{ color: speakerColor(entry.speaker) }}
                    >
                      {entry.speaker}
                    </span>
                    <span className="transcript-text">{entry.text}</span>
                  </div>
                );
              })
            ) : (
              <div className="transcript-raw">{config.transcript}</div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const TranscriptBlockExtension = Node.create({
  name: "transcriptBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      data: { default: "{}" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre",
        priority: 60,
        getAttrs(element) {
          const code = element.querySelector("code");
          if (!code) return false;
          const cls = code.className || "";
          if (cls.includes("language-transcript")) {
            return { data: code.textContent || "{}" };
          }
          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "transcript-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TranscriptBlockView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (text: string) => void; closeBlock: (node: unknown) => void },
          node: { attrs: { data: string } },
        ) {
          state.write("```transcript\n" + node.attrs.data + "\n```");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
