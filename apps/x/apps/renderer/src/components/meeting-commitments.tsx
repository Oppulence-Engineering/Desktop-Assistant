import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, X } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";

/**
 * What you agreed to, before it becomes something you forgot.
 *
 * A meeting note is a wall of text you read once. The part you needed is usually three
 * sentences — who said they would do what, by when. These are those, proposed for a
 * one-tap confirmation.
 *
 * They are **proposals**, and the UI has to say so. Nothing reaches the ledger without a
 * human agreeing, because a commitment nobody confirmed is a model's opinion and will be
 * acted on as though it were not. The quote and the play button are what make one tap
 * honest rather than rubber-stamping: you can hear the sentence before you accept it.
 */

interface Proposal {
  owner: "me" | "them";
  text: string;
  due_phrase?: string;
  confidence: number;
  evidence: string;
  start_ms: number;
  end_ms: number;
}

interface AudioTrack {
  track: "mic" | "system";
  url: string;
  offsetMs: number;
}

interface PendingSession {
  sessionId: string;
  meetingTitle?: string;
  meetingStarted?: string;
  counterparty?: string;
  notePath?: string;
  proposals: Proposal[];
}

function startedLabel(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MeetingCommitments({ onOpenNote }: { onOpenNote?: (path: string) => void }) {
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [tracks, setTracks] = useState<Record<string, AudioTrack[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** One element, reused. A fresh `new Audio()` per click leaked an element and a
   *  listener each time, and clicking three quotes played all three at once. */
  const player = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number>(Infinity);

  const key = (sessionId: string, proposal: Proposal) =>
    `${sessionId}:${proposal.start_ms}-${proposal.end_ms}`;

  const refresh = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("meeting:pendingCommitments", null);
      setSessions(result.sessions);
    } catch {
      // Nothing pending is the common case; a failure here reads the same way.
      setSessions([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A job that just finished is the most likely source of new proposals.
    const off = window.ipc.on("meeting:captureProgress", (progress) => {
      if (progress.phase === "done") void refresh();
    });
    return () => off?.();
  }, [refresh]);

  // Audio is fetched per session, lazily, because retention has usually deleted it and
  // asking for all of them up front would be mostly wasted calls.
  const tracksFor = useCallback(
    async (sessionId: string): Promise<AudioTrack[]> => {
      if (tracks[sessionId]) return tracks[sessionId];
      try {
        const audio = await window.ipc.invoke("meeting:audioTracks", { sessionId });
        setTracks((current) => ({ ...current, [sessionId]: audio.tracks }));
        return audio.tracks;
      } catch {
        setTracks((current) => ({ ...current, [sessionId]: [] }));
        return [];
      }
    },
    [tracks],
  );

  const play = useCallback(
    async (sessionId: string, proposal: Proposal) => {
      const available = await tracksFor(sessionId);
      const wanted = proposal.owner === "me" ? "mic" : "system";
      const chosen = available.find((t) => t.track === wanted) ?? available[0];
      if (!chosen) return;
      if (!player.current) {
        const element = new Audio();
        // Bound once, reading the ref each tick, so switching quotes re-aims the same
        // listener instead of stacking another one.
        element.addEventListener("timeupdate", () => {
          if (element.currentTime >= stopAt.current) element.pause();
        });
        player.current = element;
      }
      const element = player.current;
      element.pause();
      // Stop at the end of the quoted span rather than playing on into the rest of the
      // meeting — the point is to hear *this* sentence.
      stopAt.current = (proposal.end_ms - chosen.offsetMs) / 1000;
      // Transcript times are on the session clock; each file starts at its own offset.
      const seekTo = Math.max(0, (proposal.start_ms - chosen.offsetMs) / 1000);

      const begin = () => {
        element.currentTime = seekTo;
        void element.play();
      };
      if (element.src !== chosen.url) {
        element.src = chosen.url;
        // `src` is applied asynchronously; seeking before metadata lands is ignored.
        element.addEventListener("loadedmetadata", begin, { once: true });
        element.load();
      } else {
        begin();
      }
    },
    [tracksFor],
  );

  // Nothing should keep playing once the panel is gone.
  useEffect(
    () => () => {
      player.current?.pause();
      player.current = null;
    },
    [],
  );

  const act = useCallback(async (sessionId: string, proposal: Proposal, confirm: boolean) => {
    setBusy(key(sessionId, proposal));
    try {
      await window.ipc.invoke(confirm ? "meeting:confirmCommitment" : "meeting:dismissCommitment", {
        sessionId,
        startMs: proposal.start_ms,
        endMs: proposal.end_ms,
      });
      setSessions((current) =>
        current
          .map((session) =>
            session.sessionId === sessionId
              ? {
                  ...session,
                  proposals: session.proposals.filter(
                    (item) =>
                      !(item.start_ms === proposal.start_ms && item.end_ms === proposal.end_ms),
                  ),
                }
              : session,
          )
          .filter((session) => session.proposals.length > 0),
      );
    } finally {
      setBusy(null);
    }
  }, []);

  if (!loaded || sessions.length === 0) return null;

  return (
    <div className="px-6 pb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Commitments
        </h3>
        {/* Said plainly and up front: these are suggestions until you accept them. */}
        <span className="text-xs text-muted-foreground">
          suggested from the transcript · nothing is saved until you confirm
        </span>
      </div>

      <div className="overflow-hidden rounded-none border border-border/60 bg-card">
        {sessions.map((session) => (
          <div key={session.sessionId} className="border-b border-border/60 last:border-b-0">
            <div className="flex items-baseline gap-2 bg-muted/30 px-4 py-1.5">
              <span className="truncate text-xs font-medium">
                {session.meetingTitle || "Meeting"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {startedLabel(session.meetingStarted)}
              </span>
              {session.notePath && onOpenNote && (
                <button
                  type="button"
                  className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenNote(session.notePath!)}
                >
                  Open note
                </button>
              )}
            </div>
            {session.proposals.map((proposal) => {
              const id = key(session.sessionId, proposal);
              const audio = tracks[session.sessionId];
              // Undefined means "not asked yet", which must not read as "no audio".
              const playable = audio === undefined || audio.length > 0;
              return (
                <div key={id} className="border-t border-border/60 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">
                          {proposal.owner === "me"
                            ? "You"
                            : (session.counterparty ?? "The other side")}
                        </span>
                        {" — "}
                        {proposal.text}
                        {proposal.due_phrase && (
                          <span className="text-muted-foreground"> ({proposal.due_phrase})</span>
                        )}
                      </p>
                      {/* The quote and the play button are what make one tap honest
                          rather than rubber-stamping: you can hear it before accepting. */}
                      <button
                        type="button"
                        className="mt-1 flex items-start gap-1.5 text-left text-xs italic text-muted-foreground hover:text-foreground"
                        onClick={() => void play(session.sessionId, proposal)}
                        disabled={!playable}
                        title={playable ? "Hear this" : "The audio is no longer on disk"}
                      >
                        {playable && <Play className="mt-0.5 size-3 shrink-0" />}“
                        {proposal.evidence}”
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busy === id}
                        onClick={() => void act(session.sessionId, proposal, false)}
                        title="Not a commitment"
                        aria-label="Dismiss"
                      >
                        <X className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5"
                        disabled={busy === id}
                        onClick={() => void act(session.sessionId, proposal, true)}
                      >
                        {busy === id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        Keep
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
