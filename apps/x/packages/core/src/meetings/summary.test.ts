import { describe, expect, it, vi } from "vitest";
import {
  GENERATED_SECTION_HEADING,
  USER_SECTION_HEADING,
  mergeSummaryIntoNote,
  transcriptTextFromNote,
} from "@x/shared/dist/meetings.js";
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
    expect(out).toContain(`${GENERATED_SECTION_HEADING}\n\n- point one`);
    expect(out.match(/# Quarterly review/g)).toHaveLength(1);
  });

  it("survives a note with no transcript block", () => {
    const out = mergeSummaryIntoNote("---\ntitle: X\n---\n\n# X\n", "- a point");
    expect(out).toContain("- a point");
    expect(out).toContain("title: X");
  });

  /**
   * The regression this half of the change exists for. `mergeSummaryIntoNote` used to
   * rebuild the body from the title, the leading notices and the transcript block,
   * throwing away everything in between — which is where anything the user typed lived.
   */
  describe("user-authored text", () => {
    // The shape a note has during the call: generated region, then the user's section.
    const withUserNotes = NOTE.replace(
      "# Quarterly review\n",
      [
        "# Quarterly review",
        "",
        GENERATED_SECTION_HEADING,
        "",
        "> a notice",
        "",
        USER_SECTION_HEADING,
        "",
        "My own note.",
        "",
      ].join("\n"),
    );

    it("keeps text the user typed below the generated section", () => {
      const out = mergeSummaryIntoNote(withUserNotes, "- We agreed on Friday.");
      expect(out).toContain("My own note.");
      expect(out).toContain("We agreed on Friday.");
    });

    it("keeps it across repeated summarization", () => {
      let out = mergeSummaryIntoNote(withUserNotes, "- first pass");
      out = mergeSummaryIntoNote(out, "- second pass");
      expect(out).toContain("My own note.");
      // Only the generated region is replaced, so the stale summary is gone.
      expect(out).toContain("second pass");
      expect(out).not.toContain("first pass");
      // Exactly one generated region, no matter how many times this runs.
      expect(out.match(new RegExp(GENERATED_SECTION_HEADING, "g"))).toHaveLength(1);
    });

    it("preserves the notice inside the region rather than dropping it", () => {
      const out = mergeSummaryIntoNote(withUserNotes, "- a point");
      expect(out).toContain("> a notice");
    });

    it("is idempotent — re-running with the same summary changes nothing", () => {
      const once = mergeSummaryIntoNote(withUserNotes, "- a point");
      expect(mergeSummaryIntoNote(once, "- a point")).toBe(once);
    });

    it("preserves the user's text when they deleted the heading that closes the region", () => {
      // Without its closing heading the region runs to the transcript, so anything typed
      // under the summary sits inside it and is indistinguishable from it. Replacing the
      // region there would delete their text — the exact bug, one layer in — so an
      // unclosed region is treated as unowned and kept whole.
      const unclosed = withUserNotes.replace(`${USER_SECTION_HEADING}\n\n`, "");
      const out = mergeSummaryIntoNote(unclosed, "- a point");
      expect(out).toContain("My own note.");
      expect(out).toContain("- a point");
      // And it settles rather than growing on every pass.
      const again = mergeSummaryIntoNote(out, "- a later point");
      expect(again).toContain("My own note.");
      expect(again).toContain("- a later point");
    });

    it("does not touch headings the user wrote themselves", () => {
      const withOwnHeading = withUserNotes.replace(
        "My own note.",
        "## My agenda\n\nfirst point",
      );
      const out = mergeSummaryIntoNote(withOwnHeading, "- a point");
      expect(out).toContain("## My agenda");
      expect(out).toContain("first point");
    });

    it("keeps the transcript block last and unduplicated in every case", () => {
      for (const note of [
        withUserNotes,
        withUserNotes.replace(`${USER_SECTION_HEADING}\n\n`, ""),
        NOTE,
      ]) {
        const out = mergeSummaryIntoNote(note, "- a point");
        expect(out.trimEnd().endsWith("```")).toBe(true);
        expect(out.match(/```transcript/g)).toHaveLength(1);
      }
    });

    it("loses nothing from a legacy note that has no generated section", () => {
      // A note written before this change: summary and user text intermixed, no heading.
      const legacy = NOTE.replace(
        "# Quarterly review\n",
        "# Quarterly review\n\n> a notice\n\nOld summary text.\n\nMy own note.\n",
      );
      const out = mergeSummaryIntoNote(legacy, "- brand new summary");
      // Nothing is deleted — the old body is ambiguous, so it is all treated as the
      // user's. Two summaries is recoverable; a deleted paragraph is not.
      expect(out).toContain("Old summary text.");
      expect(out).toContain("My own note.");
      expect(out).toContain("brand new summary");
      expect(out.trimEnd().endsWith("```")).toBe(true);
    });
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

  it("carries several notices, blank-line separated as the formatter writes them", () => {
    // The formatter puts a blank line between each. Treating that blank as the end of
    // the run kept only the first — the privacy line survived and the speaker-attribution
    // caveat silently did not.
    const note = noteWith("> One.\n\n> Two.");
    const merged = mergeSummaryIntoNote(note, "Notes.");
    expect(merged).toContain("> One.");
    expect(merged).toContain("> Two.");
    expect(merged.indexOf("> Two.")).toBeLessThan(merged.indexOf("Notes."));
  });

  it("replaces the previous summary when the note has a generated section", () => {
    // The original intent of this test — a re-summarize replaces the old summary — still
    // holds, and now holds precisely, because the boundary is explicit rather than
    // guessed from where the blockquotes stop.
    const note = noteWith(
      [
        GENERATED_SECTION_HEADING,
        "",
        "> A notice.",
        "",
        "An older summary that must not survive.",
        "",
        // The closing heading is what makes the region safe to replace.
        USER_SECTION_HEADING,
      ].join("\n"),
    );
    const merged = mergeSummaryIntoNote(note, "The new summary.");
    expect(merged).toContain("> A notice.");
    expect(merged).toContain("The new summary.");
    expect(merged).not.toContain("older summary");
  });

  it("keeps a previous summary in a legacy note, because it cannot tell it from the user's text", () => {
    // Deliberate change of behaviour. A note written before generated sections existed
    // has no boundary in it, so the old heuristic — "prose under the quotes is the
    // summary" — was guessing, and it deleted anything the user had typed there. Keeping
    // both is recoverable in a second; deleting a paragraph is not.
    const note = noteWith("> A notice.\n\nAn older summary, indistinguishable from a user note.");
    const merged = mergeSummaryIntoNote(note, "The new summary.");
    expect(merged).toContain("> A notice.");
    expect(merged).toContain("older summary");
    expect(merged).toContain("The new summary.");
  });

  it("adds the generated section to a note that has none, without discarding its body", () => {
    const note = noteWith("Just a summary.");
    const merged = mergeSummaryIntoNote(note, "New summary.");
    expect(merged).toContain(`# Weekly sync\n\n${GENERATED_SECTION_HEADING}\n\nNew summary.`);
    expect(merged).toContain("Just a summary.");
    // The carried body gets a heading in front of it so the next write cannot absorb it.
    expect(merged).toContain(USER_SECTION_HEADING);
  });
});
