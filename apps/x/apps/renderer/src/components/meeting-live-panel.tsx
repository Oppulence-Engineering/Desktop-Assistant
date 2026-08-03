import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import type { MeetingTranscriptSegment } from "@x/shared/dist/meetings.js";
import type { RelationshipLiveCue } from "@x/shared/dist/relationships.js";

/**
 * The meeting, as it happens — and a box to ask it questions.
 *
 * "What did she say about the timeline?" answered mid-call, from a transcript on this
 * machine. This is the thing a bot-based notetaker structurally cannot do: their
 * transcript lives in someone else's cloud and shows up after the call is over.
 *
 * Two things the UI has to be honest about. The live transcript is a *second*,
 * throwaway pass that cuts audio at fixed intervals, so it clips words at the
 * boundaries — the note gets a clean re-transcription afterwards, and saying so stops
 * anyone reading rough live text as a defect. And the answers go to whichever model is
 * configured, which may be a cloud one; the privacy tab says which, and this does not
 * pretend otherwise.
 */

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MeetingLivePanel() {
  const [active, setActive] = useState(false);
  const [counterparty, setCounterparty] = useState<string | undefined>();
  const [segments, setSegments] = useState<MeetingTranscriptSegment[]>([]);
  const [cues, setCues] = useState<RelationshipLiveCue[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.ipc
      .invoke("meeting:liveTranscript", null)
      .then((state) => {
        if (cancelled) return;
        setActive(state.active);
        setCounterparty(state.counterparty);
        setSegments(state.segments);
        setCues(state.cues);
      })
      .catch(() => {});

    const offSegments = window.ipc.on("meeting:liveSegments", ({ segments: next }) => {
      setActive(true);
      // Sorted on arrival: the two tracks are transcribed in separate passes and can
      // land out of order.
      setSegments((current) => [...current, ...next].sort((a, b) => a.start_ms - b.start_ms));
    });
    const offState = window.ipc.on("meeting:captureState", (status) => {
      if (status.state === "idle") {
        setActive(false);
        setSegments([]);
        setAnswer(null);
        setCues([]);
      }
    });
    const offCues = window.ipc.on("meeting:liveCues", ({ cues: next }) => setCues(next));
    return () => {
      cancelled = true;
      offSegments();
      offState();
      offCues();
    };
  }, []);

  // Follow the conversation, which is what someone reading mid-call wants.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [segments.length]);

  const ask = useCallback(async () => {
    const asked = question.trim();
    if (!asked) return;
    setAsking(true);
    setAnswer(null);
    try {
      const result = await window.ipc.invoke("meeting:ask", { question: asked });
      setAnswer(result.error ? result.error : result.answer);
    } catch (err) {
      setAnswer((err as Error).message);
    } finally {
      setAsking(false);
    }
  }, [question]);

  if (!active && cues.length === 0) return null;

  return (
    <div className="border-b border-border bg-muted/10 px-6 py-3">
      {cues.length > 0 ? (
        <div className="mb-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Account-aware cue cards
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {cues.map((cue) => (
              <div
                key={cue.id}
                className="relative border border-amber-500/30 bg-amber-500/5 px-3 py-2 pr-8"
              >
                <button
                  type="button"
                  aria-label={`Dismiss ${cue.title}`}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setCues((current) => current.filter((item) => item.id !== cue.id));
                    void window.ipc.invoke("meeting:dismissLiveCue", { cueId: cue.id });
                  }}
                >
                  <X className="size-3.5" />
                </button>
                <p className="text-xs font-medium capitalize">{cue.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{cue.detail}</p>
                {cue.suggestedQuestion ? (
                  <button
                    type="button"
                    className="mt-1.5 text-left text-xs font-medium text-primary hover:underline"
                    onClick={() => {
                      setQuestion(cue.suggestedQuestion ?? "");
                      void window.ipc.invoke("meeting:liveCueFeedback", {
                        cueId: cue.id,
                        outcome: "question_used",
                      });
                    }}
                  >
                    Ask: {cue.suggestedQuestion}
                  </button>
                ) : null}
                {cue.privacyRoute === "deterministic" ? (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Generated locally · source linked
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {active ? (
        <>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Live transcript
            </h3>
            {/* Rough live text is expected, not a defect — say so before anyone reports it. */}
            <span className="text-xs text-muted-foreground">
              rough while recording · the note gets a clean re-transcription afterwards
            </span>
          </div>

          <div
            ref={scroller}
            className="max-h-48 overflow-y-auto rounded-none border border-border/60 bg-card px-3 py-2 text-sm"
          >
            {segments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Listening…</p>
            ) : (
              segments.map((segment, index) => (
                <p key={index} className="mb-1 last:mb-0">
                  <span className="mr-2 text-xs tabular-nums text-muted-foreground">
                    {clock(segment.start_ms)}
                  </span>
                  <span className="font-medium">
                    {segment.speaker === "me" ? "You" : (counterparty ?? "Other")}
                  </span>
                  <span className="text-muted-foreground">: {segment.text}</span>
                </p>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder="Ask about this meeting — what did they say about pricing?"
              className="min-w-0 flex-1 border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
            />
            <Button
              type="button"
              size="sm"
              disabled={asking || !question.trim()}
              onClick={() => void ask()}
            >
              {asking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Ask
            </Button>
          </div>

          {answer && (
            <p className="mt-2 whitespace-pre-wrap border-l-2 border-primary/40 py-1 pl-3 text-sm">
              {answer}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
