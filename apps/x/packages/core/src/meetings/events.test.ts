import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { MeetingTranscript } from "@x/shared/dist/meetings.js";
import { sessionMeta } from "./factories.testkit.js";

/**
 * A finished meeting is announced on the event bus so it is visible to anything that is
 * not the meetings UI — in particular user-authored background tasks. The payload is
 * markdown by contract, so it is written to be read by a model.
 */

let tmpDir: string;
let events: typeof import("./events.js");
let pendingDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-meeting-events-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  events = await import("./events.js");
  pendingDir = path.join(tmpDir, "events", "pending");
}, 30000);

afterAll(async () => {
  await fs
    .rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(() => {});
  delete process.env.SOLOMON_WORKDIR;
});

beforeEach(async () => {
  await fs.rm(pendingDir, { recursive: true, force: true }).catch(() => {});
});

const transcript = (segments: MeetingTranscript["segments"]): MeetingTranscript => ({
  schema: 1,
  engine: "whisper.cpp",
  model: "base.en-q5_1",
  created_at: "2026-07-30T10:05:00.000Z",
  segments,
});

async function published() {
  const files = await fs.readdir(pendingDir);
  expect(files).toHaveLength(1);
  return JSON.parse(await fs.readFile(path.join(pendingDir, files[0]), "utf8"));
}

describe("publishMeetingTranscribed", () => {
  it("writes a meeting event carrying the transcript and the note path", async () => {
    await events.publishMeetingTranscribed({
      sessionId: "2026.07.30-1000",
      meta: sessionMeta({ duration_seconds: 125 }),
      transcript: transcript([
        { speaker: "me", start_ms: 0, end_ms: 1000, text: "Morning." },
        { speaker: "them", start_ms: 1000, end_ms: 2000, text: "Shall we start?" },
      ]),
      notePath: "knowledge/Meetings/solomon/2026-07-30/x.md",
      now: () => new Date("2026-07-30T10:06:00.000Z"),
    });

    const event = await published();
    expect(event.source).toBe("meeting");
    expect(event.type).toBe("meeting.transcribed");
    expect(event.createdAt).toBe("2026-07-30T10:06:00.000Z");
    expect(event.payload).toContain("2026.07.30-1000");
    expect(event.payload).toContain("Duration: 2 minutes");
    expect(event.payload).toContain("knowledge/Meetings/solomon/2026-07-30/x.md");
    expect(event.payload).toContain("**You:** Morning.");
    expect(event.payload).toContain("**Other:** Shall we start?");
  });

  it("says so plainly when nothing was said", async () => {
    await events.publishMeetingTranscribed({
      sessionId: "2026.07.30-1100",
      meta: sessionMeta(),
      transcript: transcript([]),
    });
    expect((await published()).payload).toContain("No speech was detected");
  });

  it("truncates a very long transcript rather than writing a novel", async () => {
    const long = "word ".repeat(12_000);
    await events.publishMeetingTranscribed({
      sessionId: "2026.07.30-1200",
      meta: sessionMeta(),
      transcript: transcript([{ speaker: "me", start_ms: 0, end_ms: 1, text: long }]),
    });

    const event = await published();
    expect(event.payload).toContain("transcript truncated");
    expect(event.payload.length).toBeLessThan(21_000);
  });

  it("uses singular minutes for a short meeting", async () => {
    await events.publishMeetingTranscribed({
      sessionId: "2026.07.30-1300",
      meta: sessionMeta({ duration_seconds: 20 }),
      transcript: transcript([{ speaker: "me", start_ms: 0, end_ms: 1, text: "hi" }]),
    });
    expect((await published()).payload).toContain("Duration: 1 minute\n");
  });
});
