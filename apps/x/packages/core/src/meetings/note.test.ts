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
      nativeProvenance({ model: "base.en-q5_1", systemAudioCaptured: false }),
    );

    expect(note).toContain("transcription_provider: whisper.cpp");
    expect(note).toContain("transcription_model: base.en-q5_1");
    expect(note).toContain("diarization_provider: dual-track");
    expect(note).toContain("audio_uploaded: false");
    expect(note).toContain("capture_engine: native");
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
    // Directly under the title, above anything a summary pass prepends.
    const lines = note.split("\n");
    expect(lines[lines.findIndex((l) => l.startsWith("# ")) + 1]).toBe("");
    expect(lines[lines.findIndex((l) => l.startsWith("# ")) + 2]).toContain(
      "The audio never left this device",
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
      ]),
    ).toEqual([
      { speaker: "You", text: "One. Two." },
      { speaker: "Other", text: "Three." },
      { speaker: "You", text: "Four." },
    ]);
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
  const provenance = nativeProvenance({ model: "base.en-q5_1", systemAudioCaptured: true });

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
});
