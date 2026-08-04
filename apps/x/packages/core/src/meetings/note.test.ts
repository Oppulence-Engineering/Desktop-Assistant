import { describe, expect, it } from "vitest";
import {
  clockLabel,
  formatMeetingNote,
  renderTranscriptMarkdown,
  segmentsToEntries,
  type MeetingTranscriptSegment,
} from "@x/shared/dist/meetings.js";
import { meetingNotePath, nativeProvenance, writeMeetingNote } from "./note.js";

/**
 * Note shape is a compatibility surface, not an implementation detail:
 * `meeting:summarize` prepends its output above the fenced `transcript` block, the
 * editor renders that block as a node, and note listing filters on `source: solomon`.
 * The golden below is the note the renderer capture path already produces — if this
 * test has to change, existing notes are about to render differently.
 */

const segment = (over: Partial<MeetingTranscriptSegment>): MeetingTranscriptSegment => ({
  speaker: "me",
  start_ms: 0,
  end_ms: 1000,
  text: "hello",
  ...over,
});

describe("formatMeetingNote", () => {
  it("matches the note shape the renderer path writes", () => {
    const note = formatMeetingNote(
      [
        { speaker: "You", text: "Morning." },
        { speaker: "Other", text: "Morning — shall we start?" },
      ],
      "2026-07-29T10:00:00.000Z",
    );

    expect(note).toBe(
      [
        "---",
        "type: meeting",
        "source: solomon",
        "title: Meeting Notes",
        'date: "2026-07-29T10:00:00.000Z"',
        "---",
        "",
        "# Meeting Notes",
        "",
        // The two headings bound the region this app rewrites. Everything between
        // `## Notes` and the transcript block belongs to the user and is copied through
        // by every later write, which is what stops a summary from eating notes typed
        // during the call.
        "## Meeting summary",
        "",
        "## Notes",
        "",
        "```transcript",
        JSON.stringify({
          // Three newlines on a speaker change, not two: the renderer pushes a blank
          // after every entry *and* another before a change. Preserved deliberately —
          // existing notes are stored with this exact spacing.
          transcript: "**You:** Morning.\n\n\n**Other:** Morning — shall we start?",
        }),
        "```",
      ].join("\n"),
    );
  });

  it("puts the transcript block last so summaries can be prepended above it", () => {
    const note = formatMeetingNote([{ speaker: "You", text: "hi" }], "2026-07-29T10:00:00.000Z");
    expect(note.trimEnd().endsWith("```")).toBe(true);
    expect(note.indexOf("```transcript")).toBeGreaterThan(note.lastIndexOf("---"));
  });

  it("writes provenance as flat frontmatter with booleans stringified", () => {
    const note = formatMeetingNote(
      [],
      "2026-07-29T10:00:00.000Z",
      undefined,
      nativeProvenance({
        model: "base.en-q5_1",
        sessionId: "2026.07.29-1000",
        systemAudioCaptured: false,
      }),
    );

    expect(note).toContain("transcription_provider: whisper.cpp");
    expect(note).toContain("transcription_model: base.en-q5_1");
    expect(note).toContain("diarization_provider: dual-track");
    expect(note).toContain("audio_uploaded: false");
    expect(note).toContain("capture_engine: native");
    // Links the note back to its recording, which is what makes click-to-play possible.
    expect(note).toContain("session_id: 2026.07.29-1000");
    // The one that stops a one-sided transcript from looking like a silent meeting.
    expect(note).toContain("system_audio_captured: false");
  });

  it("states on the note itself that the audio never left, when it did not", () => {
    const note = formatMeetingNote(
      [{ speaker: "You", text: "hi" }],
      "2026-07-29T10:00:00.000Z",
      undefined,
      nativeProvenance({ model: "parakeet-tdt-0.6b-v3", systemAudioCaptured: true }),
    );

    expect(note).toContain("> Recorded and transcribed on this Mac.");
    // Same intent as before — the notice sits above anything a summary pass writes — but
    // the position is now expressed against the generated region that bounds both, since
    // the summary lands inside that region rather than loose under the title.
    expect(note.indexOf("## Meeting summary")).toBeLessThan(
      note.indexOf("The audio never left this device"),
    );
    expect(note.indexOf("The audio never left this device")).toBeLessThan(
      note.indexOf("## Notes"),
    );
  });

  it("claims nothing when the audio was uploaded, or when provenance is unknown", () => {
    const cloud = formatMeetingNote([], "2026-07-29T10:00:00.000Z", undefined, {
      transcription_provider: "deepgram",
      audio_uploaded: true,
    });
    expect(cloud).not.toContain("never left this device");

    // An importer writes no provenance at all — it cannot honestly make the claim.
    expect(formatMeetingNote([], "2026-07-29T10:00:00.000Z")).not.toContain("never left");
  });

  it("serializes a calendar event onto one line, escaping quotes", () => {
    const note = formatMeetingNote([], "2026-07-29T10:00:00.000Z", {
      summary: "Quarterly review",
      start: { dateTime: "2026-07-29T10:00:00Z" },
      conferenceLink: "https://meet.example.com/abc",
    });

    expect(note).toContain("title: Quarterly review");
    const line = note.split("\n").find((l) => l.startsWith("calendar_event:"))!;
    expect(line).toContain('"summary":"Quarterly review"');
    expect(line).not.toContain("\n");
  });

  it("escapes single quotes in the calendar event so the frontmatter stays valid", () => {
    const note = formatMeetingNote([], "2026-07-29T10:00:00.000Z", {
      summary: "Dave's review",
    });
    const line = note.split("\n").find((l) => l.startsWith("calendar_event:"))!;
    expect(line).toContain("Dave''s review");
  });
});

describe("segmentsToEntries", () => {
  it("merges consecutive turns from the same speaker", () => {
    expect(
      segmentsToEntries([
        segment({ speaker: "me", text: "One." }),
        segment({ speaker: "me", text: "Two." }),
        segment({ speaker: "them", text: "Three." }),
        segment({ speaker: "me", text: "Four." }),
      ]).map((entry) => ({ speaker: entry.speaker, text: entry.text })),
    ).toEqual([
      { speaker: "You", text: "One. Two." },
      { speaker: "Other", text: "Three." },
      { speaker: "You", text: "Four." },
    ]);
  });

  it("a merged run spans from its first start to its last end", () => {
    // Clicking a paragraph must seek to where the person started speaking, not to the
    // last fragment that happened to be appended to it.
    const [entry] = segmentsToEntries([
      segment({ speaker: "me", text: "One.", start_ms: 1000, end_ms: 2000 }),
      segment({ speaker: "me", text: "Two.", start_ms: 2000, end_ms: 4500 }),
    ]);
    expect(entry.start_ms).toBe(1000);
    expect(entry.end_ms).toBe(4500);
  });

  it("tags each entry with the file its speaker was recorded to", () => {
    const entries = segmentsToEntries([segment({ speaker: "me" }), segment({ speaker: "them" })]);
    expect(entries.map((e) => e.track)).toEqual(["mic", "system"]);
  });

  it("puts timings in the block without changing the transcript text", () => {
    // Older notes, hand-edited notes and imported ones have no segments at all, so the
    // rendered text stays the single source of truth for *what was said*.
    const note = formatMeetingNote(
      segmentsToEntries([segment({ speaker: "me", text: "Hi.", start_ms: 500, end_ms: 900 })]),
      "2026-07-29T10:00:00.000Z",
      undefined,
      undefined,
      "2026.07.29-1000",
    );
    const block = JSON.parse(note.split("```transcript\n")[1].split("\n```")[0]);
    expect(block.transcript).toBe("**You:** Hi.");
    expect(block.segments).toEqual([
      { speaker: "You", text: "Hi.", start_ms: 500, end_ms: 900, track: "mic" },
    ]);
    expect(block.sessionId).toBe("2026.07.29-1000");
  });

  it("omits segments entirely when nothing is timed", () => {
    const note = formatMeetingNote(
      [{ speaker: "You", text: "typed by hand" }],
      "2026-07-29T10:00:00.000Z",
    );
    const block = JSON.parse(note.split("```transcript\n")[1].split("\n```")[0]);
    expect(block.segments).toBeUndefined();
    expect(block.sessionId).toBeUndefined();
  });

  it("uses the same speaker labels the renderer path writes", () => {
    const entries = segmentsToEntries([segment({ speaker: "me" }), segment({ speaker: "them" })]);
    expect(entries.map((e) => e.speaker)).toEqual(["You", "Other"]);
  });

  it("drops blank segments", () => {
    expect(segmentsToEntries([segment({ text: "  " })])).toEqual([]);
  });
});

describe("clockLabel", () => {
  it("formats mm:ss and grows to h:mm:ss", () => {
    expect(clockLabel(0)).toBe("0:00");
    expect(clockLabel(9_000)).toBe("0:09");
    expect(clockLabel(75_000)).toBe("1:15");
    expect(clockLabel(3_600_000)).toBe("1:00:00");
    expect(clockLabel(3_725_000)).toBe("1:02:05");
  });

  it("does not render negative time", () => {
    expect(clockLabel(-5_000)).toBe("0:00");
  });
});

describe("renderTranscriptMarkdown", () => {
  it("timestamps each turn and records the engine", () => {
    const markdown = renderTranscriptMarkdown(
      {
        schema: 1,
        engine: "whisper.cpp",
        model: "base.en-q5_1",
        created_at: "2026-07-29T10:05:00.000Z",
        segments: [
          segment({ speaker: "them", start_ms: 65_000, text: "Over to you." }),
          segment({ speaker: "me", start_ms: 68_000, text: "Thanks." }),
        ],
      },
      "2026.07.29-1000",
    );

    expect(markdown).toContain("# 2026.07.29-1000");
    expect(markdown).toContain("engine: whisper.cpp (base.en-q5_1)");
    expect(markdown).toContain("**[1:05] Other:** Over to you.");
    expect(markdown).toContain("**[1:08] You:** Thanks.");
  });
});

describe("meetingNotePath", () => {
  it("files by start date, matching the renderer path", () => {
    expect(
      meetingNotePath({
        startedAt: new Date("2026-07-29T10:00:00.000Z"),
        sessionId: "2026.07.29-1000",
      }),
    ).toBe("knowledge/Meetings/solomon/2026-07-29/meeting-2026.07.29-1000.md");
  });

  it("uses the calendar summary, stripped of path-hostile characters", () => {
    expect(
      meetingNotePath({
        startedAt: new Date("2026-07-29T10:00:00.000Z"),
        sessionId: "2026.07.29-1000",
        calendarEvent: { summary: 'Q3 planning: roadmap/budget?"' },
      }),
    ).toBe("knowledge/Meetings/solomon/2026-07-29/Q3_planning_roadmapbudget.md");
  });

  it("falls back to the session id when a summary sanitizes to nothing", () => {
    expect(
      meetingNotePath({
        startedAt: new Date("2026-07-29T10:00:00.000Z"),
        sessionId: "2026.07.29-1000",
        calendarEvent: { summary: "///" },
      }),
    ).toBe("knowledge/Meetings/solomon/2026-07-29/meeting-2026.07.29-1000.md");
  });
});

describe("writeMeetingNote", () => {
  const provenance = nativeProvenance({
    model: "base.en-q5_1",
    sessionId: "2026.07.29-1000",
    systemAudioCaptured: true,
  });

  it("flags a note with no speech, so it is not mistaken for a pending transcript", async () => {
    let written = "";
    await writeMeetingNote({
      sessionId: "2026.07.29-1000",
      startedAt: "2026-07-29T10:00:00.000Z",
      segments: [],
      provenance,
      write: async (_path, data) => {
        written = data;
        return { success: true } as never;
      },
    });
    expect(written).toContain("no_speech_detected: true");
  });

  it("does not flag a note that has speech", async () => {
    let written = "";
    await writeMeetingNote({
      sessionId: "2026.07.29-1000",
      startedAt: "2026-07-29T10:00:00.000Z",
      segments: [segment({ text: "We agreed on Friday." })],
      provenance,
      write: async (_path, data) => {
        written = data;
        return { success: true } as never;
      },
    });
    expect(written).not.toContain("no_speech_detected");
    expect(written).toContain("We agreed on Friday.");
  });

  it("writes to the path it is given rather than deriving a second one", async () => {
    let path = "";
    const result = await writeMeetingNote({
      sessionId: "2026.07.29-1000",
      startedAt: "2026-07-29T10:00:00.000Z",
      segments: [],
      provenance,
      notePath: "knowledge/Meetings/solomon/2026-07-29/pinned.md",
      write: async (p) => {
        path = p;
        return { success: true } as never;
      },
    });
    expect(path).toBe("knowledge/Meetings/solomon/2026-07-29/pinned.md");
    expect(result).toBe(path);
  });

  /**
   * The regression this exists for. A session writes its note twice — an empty
   * placeholder when recording starts, so there is something to open during the call,
   * and again once the transcript lands. The second write used to render a fresh
   * document and overwrite the file, so notes typed *during* the meeting were gone
   * before the summarizer ever ran.
   */
  describe("the second write of a session", () => {
    /** Runs the real two-write sequence against an in-memory file. */
    async function captureSession(typedDuringCall: (placeholder: string) => string) {
      let file = "";
      const io = {
        notePath: "knowledge/Meetings/solomon/2026-07-29/standup.md",
        write: async (_p: string, data: string) => {
          file = data;
          return { success: true } as never;
        },
        read: async () => ({ data: file }) as never,
      };

      // 1. Recording starts: placeholder note, no transcript yet.
      await writeMeetingNote({
        sessionId: "2026.07.29-1000",
        startedAt: "2026-07-29T10:00:00.000Z",
        segments: [],
        provenance,
        ...io,
      });

      // 2. The user types into it while the meeting runs.
      file = typedDuringCall(file);

      // 3. Transcription finishes and the note is written again.
      await writeMeetingNote({
        sessionId: "2026.07.29-1000",
        startedAt: "2026-07-29T10:00:00.000Z",
        segments: [segment({ text: "We agreed on Friday." })],
        provenance,
        ...io,
      });
      return file;
    }

    it("keeps notes the user typed while the meeting was running", async () => {
      const out = await captureSession((placeholder) =>
        placeholder.replace("## Notes\n", "## Notes\n\n- ask about the contract renewal\n"),
      );
      expect(out).toContain("- ask about the contract renewal");
      // And the transcript still arrived.
      expect(out).toContain("We agreed on Friday.");
    });

    it("still refreshes the parts it owns", async () => {
      const out = await captureSession((placeholder) => placeholder);
      // The placeholder's no-speech flag is gone now that there is speech.
      expect(out).not.toContain("no_speech_detected");
      expect(out.trimEnd().endsWith("```")).toBe(true);
    });

    it("writes a fresh note when the existing one cannot be read", async () => {
      let written = "";
      await writeMeetingNote({
        sessionId: "2026.07.29-1000",
        startedAt: "2026-07-29T10:00:00.000Z",
        segments: [segment({ text: "Hello." })],
        provenance,
        // A read failure is the first-write case, not a reason to lose the transcript.
        read: async () => {
          throw new Error("gone");
        },
        write: async (_p, data) => {
          written = data;
          return { success: true } as never;
        },
      });
      expect(written).toContain("Hello.");
    });
  });
});
