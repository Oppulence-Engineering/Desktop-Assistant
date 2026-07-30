import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Resolved before the module under test is imported, because both it and the calendar
// reader derive their paths from `WorkDir` at import time.
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "notify-"));
const syncDir = path.join(workDir, "calendar_sync");

const notify = vi.fn();
vi.mock("../config/config.js", () => ({ WorkDir: workDir }));
vi.mock("../di/container.js", () => ({
  default: {
    resolve: () => ({ isSupported: () => true, notify }),
  },
}));

const { tick } = await import("./notify_calendar_meetings.js");

const T0 = Date.parse("2026-07-30T15:00:00.000Z");

async function writeEvent(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await fs.mkdir(syncDir, { recursive: true });
  await fs.writeFile(
    path.join(syncDir, `${id}.json`),
    JSON.stringify({
      id,
      summary: "Weekly sync",
      start: { dateTime: new Date(T0).toISOString() },
      end: { dateTime: new Date(T0 + 30 * 60_000).toISOString() },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      ...over,
    }),
    "utf8",
  );
}

function titles(): string[] {
  return notify.mock.calls.map((call) => call[0].title as string);
}

describe("calendar notification tick", () => {
  beforeEach(async () => {
    notify.mockClear();
    await fs.rm(syncDir, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The tick reads `Date.now()` directly, so time is faked rather than injected. */
  function at(offsetFromStartMs: number): void {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + offsetFromStartMs);
  }

  it("sends the join reminder about a minute out", async () => {
    await writeEvent("evt");
    at(-60_000);
    const { dirty } = await tick({ notifiedEventIds: {} });
    expect(titles()).toEqual(["Upcoming meeting"]);
    expect(dirty).toBe(true);
  });

  it("does not send the same join reminder twice", async () => {
    await writeEvent("evt");
    at(-60_000);
    const state = { notifiedEventIds: {} };
    await tick(state);
    notify.mockClear();
    await tick(state);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps using the bare event id for the join reminder", async () => {
    // Every entry already in a user's state file is keyed this way. Prefixing it would
    // re-fire the reminder for every event currently inside the window.
    await writeEvent("evt");
    at(-60_000);
    const state = { notifiedEventIds: {} };
    await tick(state);
    expect(Object.keys(state.notifiedEventIds)).toEqual(["evt"]);
  });

  it("a readiness warning does not suppress the join reminder for the same meeting", async () => {
    await writeEvent("evt");
    const state = { notifiedEventIds: {} };
    const preflight = vi.fn().mockResolvedValue({ summary: "microphone: denied" });

    // Readiness fires first, at ~2 minutes out...
    at(-150_000);
    await tick(state, { preflight });
    expect(titles()).toEqual(["Check your recording setup"]);

    // ...and the join reminder still fires afterwards, at ~1 minute out.
    notify.mockClear();
    at(-60_000);
    await tick(state, { preflight });
    expect(titles()).toEqual(["Upcoming meeting"]);
  });

  it("says nothing when the machine is ready", async () => {
    await writeEvent("evt");
    at(-150_000);
    const preflight = vi.fn().mockResolvedValue(null);
    const state = { notifiedEventIds: {} };
    await tick(state, { preflight });
    expect(notify).not.toHaveBeenCalled();
    // Still recorded, so a healthy machine is not re-checked every tick.
    expect(state.notifiedEventIds["preflight:evt"]).toBeDefined();
  });

  it("checks readiness once even when several meetings are due", async () => {
    await writeEvent("a");
    await writeEvent("b", { id: "b" });
    at(-150_000);
    const preflight = vi.fn().mockResolvedValue({ summary: "disk space: 20 MB free" });
    await tick({ notifiedEventIds: {} }, { preflight });
    expect(preflight).toHaveBeenCalledTimes(1);
    // One warning, not one per meeting — the problem is with the machine.
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("offers to record as the meeting starts, once", async () => {
    await writeEvent("evt");
    at(5_000);
    const state = { notifiedEventIds: {} };
    const recordPolicy = vi.fn().mockResolvedValue("prompt");
    await tick(state, { recordPolicy });
    expect(titles()).toContain('"Weekly sync" is starting');

    notify.mockClear();
    await tick(state, { recordPolicy });
    expect(titles()).not.toContain('"Weekly sync" is starting');
  });

  it("never offers to record over a session already running", async () => {
    await writeEvent("evt");
    at(5_000);
    const recordPolicy = vi.fn().mockResolvedValue("prompt");
    await tick({ notifiedEventIds: {} }, { recordPolicy, isRecording: () => true });
    expect(recordPolicy).not.toHaveBeenCalled();
  });

  it("skips meetings with no join link", async () => {
    await writeEvent("evt", { hangoutLink: undefined });
    at(5_000);
    const recordPolicy = vi.fn().mockResolvedValue("prompt");
    await tick({ notifiedEventIds: {} }, { recordPolicy });
    expect(recordPolicy).not.toHaveBeenCalled();
  });

  it("starts silently on the auto policy, but still says it is recording", async () => {
    await writeEvent("evt");
    // A minute in: past the join reminder's window, still inside the record window. In a
    // real run the join reminder fired a tick or two earlier and is already deduped;
    // asserting at +5s would catch both and say nothing about the auto path.
    at(60_000);
    const startRecording = vi.fn().mockResolvedValue(undefined);
    await tick({ notifiedEventIds: {} }, { recordPolicy: async () => "auto", startRecording });
    expect(startRecording).toHaveBeenCalledTimes(1);
    // A recording that begins with no notice is the behaviour this must not have,
    // whatever the user opted into.
    expect(titles()).toEqual(["Recording this meeting"]);
  });

  it("does not re-evaluate an event the policy declined", async () => {
    await writeEvent("evt");
    at(5_000);
    const state = { notifiedEventIds: {} };
    const recordPolicy = vi.fn().mockResolvedValue("off");
    await tick(state, { recordPolicy });
    await tick(state, { recordPolicy });
    expect(recordPolicy).toHaveBeenCalledTimes(1);
  });

  it("survives a preflight that throws", async () => {
    await writeEvent("evt");
    at(-150_000);
    const preflight = vi.fn().mockRejectedValue(new Error("sidecar gone"));
    await expect(tick({ notifiedEventIds: {} }, { preflight })).resolves.toBeDefined();
    // A readiness check that throws must not become a warning about the meeting.
    expect(notify).not.toHaveBeenCalled();
  });
});
