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
