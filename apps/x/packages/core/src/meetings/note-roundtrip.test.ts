import { describe, expect, it } from "vitest";
import {
  formatMeetingNote,
  mergeSummaryIntoNote,
  segmentsToEntries,
} from "@x/shared/meetings";
import { nativeProvenance } from "./note.js";

describe("a summarized group-call note keeps every claim it makes", () => {
  it("end to end, through the real formatter and the real merge", () => {
    const note = formatMeetingNote(
      segmentsToEntries([
        { speaker: "them", start_ms: 0, end_ms: 900, text: "we'll send it Friday" },
      ]),
      "2026-07-29T10:00:00.000Z",
      { summary: "Quarterly review" },
      nativeProvenance({
        model: "parakeet-tdt-0.6b-v3",
        sessionId: "2026.07.29-1000",
        systemAudioCaptured: true,
        attributionLimit: "3 other participants — channel-based attribution cannot tell them apart",
      }),
      "2026.07.29-1000",
    );
    const merged = mergeSummaryIntoNote(note, "## Notes\n\nThey agreed to send it.");

    // Both standing claims survive summarization — the bug this guards is that they did
    // not, on every meeting that had speech in it.
    expect(merged).toContain("The audio never left this device");
    expect(merged).toContain("all 3 other participants appear as **Other**");
    expect(merged).toContain("They agreed to send it.");
    // Transcript block still last, and click-to-play timings survived the round trip.
    expect(merged.trimEnd().endsWith("```")).toBe(true);
    const block = JSON.parse(merged.split("```transcript\n")[1].split("\n```")[0]);
    expect(block.segments[0].start_ms).toBe(0);
    expect(block.sessionId).toBe("2026.07.29-1000");
  });
});
