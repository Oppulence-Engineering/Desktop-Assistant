import { describe, expect, it, vi } from "vitest";
import { mergeSummaryIntoNote, transcriptTextFromNote } from "@x/shared/dist/meetings.js";
import { summarizeMeetingNote } from "./summary.js";
import { sessionMeta } from "./factories.testkit.js";

/**
 * Guards the regression this was written for: native capture transcribes *after* stop,
 * so summarizing at stop ran the model over an empty placeholder and the queue's own
 * note write then discarded the result. A meeting ended up with a transcript and no
 * summary, and an LLM call was paid for nothing.
 */

const NOTE = [
  "---",
  "type: meeting",
  "source: solomon",
  "title: Quarterly review",
  'date: "2026-07-30T10:00:00.000Z"',
  "capture_engine: native",
  "---",
  "",
  "# Quarterly review",
  "",
  "```transcript",
  JSON.stringify({ transcript: "**You:** Morning.\n\n\n**Other:** Shall we start?" }),
  "```",
].join("\n");

function harness(note: string, summary = "## Notes\n\n- We agreed on Friday.") {
  const written: { path: string; data: string }[] = [];
  return {
    written,
    args: {
      dir: "/tmp/session",
      notePath: "knowledge/Meetings/solomon/2026-07-30/x.md",
      meta: sessionMeta(),
      summarize: vi.fn(async () => summary),
      read: vi.fn(async () => ({ data: note }) as never),
      write: vi.fn(async (path: string, data: string) => {
        written.push({ path, data });
        return { success: true } as never;
      }),
    },
  };
}

describe("summarizeMeetingNote", () => {
  it("summarizes a note that has a transcript and keeps the block last", async () => {
    const h = harness(NOTE);
    expect(await summarizeMeetingNote(h.args)).toBe(true);

    const out = h.written[0].data;
    expect(out).toContain("We agreed on Friday.");
    // The transcript block survives verbatim and stays last, because meeting:summarize is
    // defined as prepending above it and the editor renders it as a node.
    expect(out.trimEnd().endsWith("```")).toBe(true);
    expect(out).toContain('{"transcript":"**You:** Morning.');
    // Frontmatter is preserved byte-for-byte, not re-serialized.
    expect(out.startsWith(NOTE.slice(0, NOTE.indexOf("\n\n# ")))).toBe(true);
  });

  it("does not call the model when the transcript is empty", async () => {
    // Exactly the native-at-stop case: placeholder note, nothing said yet.
    const placeholder = NOTE.replace(
      /```transcript\n.*\n```/,
      "```transcript\n" + JSON.stringify({ transcript: "" }) + "\n```",
    );
    const h = harness(placeholder);

    expect(await summarizeMeetingNote(h.args)).toBe(false);
    expect(h.args.summarize).not.toHaveBeenCalled();
    expect(h.written).toEqual([]);
  });

  it("leaves the note alone when the model fails", async () => {
    const h = harness(NOTE);
    h.args.summarize = vi.fn(async () => {
      throw new Error("model unavailable");
    });

    expect(await summarizeMeetingNote(h.args)).toBe(false);
    // A transcript with no summary beats a clobbered note.
    expect(h.written).toEqual([]);
  });

  it("leaves the note alone when the model returns nothing", async () => {
    const h = harness(NOTE, "   ");
    expect(await summarizeMeetingNote(h.args)).toBe(false);
    expect(h.written).toEqual([]);
  });

  it("is a no-op when the note cannot be read", async () => {
    const h = harness(NOTE);
    h.args.read = vi.fn(async () => {
      throw new Error("gone");
    });
    expect(await summarizeMeetingNote(h.args)).toBe(false);
  });
});

describe("mergeSummaryIntoNote", () => {
  it("strips the model's own heading, since the note already has a title", () => {
    const out = mergeSummaryIntoNote(NOTE, "# Quarterly review\n\n- point one");
    expect(out).toContain("# Quarterly review\n\n- point one");
    expect(out.match(/# Quarterly review/g)).toHaveLength(1);
  });

  it("survives a note with no transcript block", () => {
    const out = mergeSummaryIntoNote("---\ntitle: X\n---\n\n# X\n", "- a point");
    expect(out).toContain("- a point");
    expect(out).toContain("title: X");
  });
});

describe("transcriptTextFromNote", () => {
  it("reads the fenced JSON payload", () => {
    expect(transcriptTextFromNote(NOTE)).toContain("**You:** Morning.");
  });

  it("returns empty for a missing or unparseable block", () => {
    expect(transcriptTextFromNote("# no block")).toBe("");
    expect(transcriptTextFromNote("```transcript\nnot json\n```")).toBe("");
  });
});

describe("mergeSummaryIntoNote keeps what the note claims about itself", () => {
  const noteWith = (body: string) =>
    [
      "---",
      "type: meeting",
      "title: Weekly sync",
      "---",
      "",
      "# Weekly sync",
      "",
      body,
      "",
      "```transcript",
      '{"transcript":"**You:** hi"}',
      "```",
    ].join("\n");

  it("carries leading blockquote notices above the summary", () => {
    // These lines are the note's standing claims — that the audio never left, and that
    // several people share one speaker label. Summarizing rebuilds the body, and before
    // this they were silently deleted from every meeting that had speech in it.
    const note = noteWith(
      "> Recorded and transcribed on this Mac. The audio never left this device.",
    );
    const merged = mergeSummaryIntoNote(note, "## Notes\n\nThey synced.");
    expect(merged).toContain("The audio never left this device");
    expect(merged).toContain("They synced.");
    // Still above the summary, and the transcript block still last.
    expect(merged.indexOf("never left")).toBeLessThan(merged.indexOf("They synced."));
    expect(merged.trimEnd().endsWith("```")).toBe(true);
  });

  it("carries several notices", () => {
    const note = noteWith("> One.\n> Two.");
    const merged = mergeSummaryIntoNote(note, "Notes.");
    expect(merged).toContain("> One.");
    expect(merged).toContain("> Two.");
  });

  it("does not carry a previous summary forward", () => {
    // Only the leading quotes are notices; prose below them is the old summary, which is
    // precisely what a re-summarize is replacing.
    const note = noteWith("> A notice.\n\nAn older summary that must not survive.");
    const merged = mergeSummaryIntoNote(note, "The new summary.");
    expect(merged).toContain("> A notice.");
    expect(merged).not.toContain("older summary");
  });

  it("is unchanged for a note with no notices", () => {
    const note = noteWith("Just a summary.");
    const merged = mergeSummaryIntoNote(note, "New summary.");
    expect(merged).toContain("# Weekly sync\n\nNew summary.");
  });
});
