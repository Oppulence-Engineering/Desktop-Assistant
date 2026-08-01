import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  extractConferenceLink,
  conferenceProviderLabel,
  isEventNow,
  resolveCalendarEvent,
  startsWithin,
} from "@x/shared/dist/calendar.js";
import { listCalendarEvents, listEventsInProgress, listUpcomingEvents } from "./calendar_events.js";

const T0 = Date.parse("2026-07-30T15:00:00.000Z");

function event(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    summary: "Weekly sync",
    start: { dateTime: new Date(T0).toISOString() },
    end: { dateTime: new Date(T0 + 30 * 60_000).toISOString() },
    ...over,
  };
}

describe("extractConferenceLink", () => {
  it("prefers structured video entry points", () => {
    expect(
      extractConferenceLink({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+15551234" },
            { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
          ],
        },
        hangoutLink: "https://meet.google.com/ignored",
      }),
    ).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("falls back to hangoutLink, then a link in the body", () => {
    expect(extractConferenceLink({ hangoutLink: "https://meet.google.com/xyz" })).toBe(
      "https://meet.google.com/xyz",
    );
    expect(
      extractConferenceLink({
        description: "Dial in here: https://acme.zoom.us/j/98765?pwd=Ab1 — see you then",
      }),
    ).toBe("https://acme.zoom.us/j/98765?pwd=Ab1");
  });

  it("decodes &amp; from HTML descriptions", () => {
    expect(
      extractConferenceLink({ description: "<a>https://acme.zoom.us/j/1?pwd=x&amp;uid=2</a>" }),
    ).toBe("https://acme.zoom.us/j/1?pwd=x&uid=2");
  });

  it("returns undefined when there is no link", () => {
    expect(extractConferenceLink({ location: "Room 4B" })).toBeUndefined();
  });

  it("labels the provider", () => {
    expect(conferenceProviderLabel("https://acme.zoom.us/j/1")).toBe("Zoom");
    expect(conferenceProviderLabel("https://teams.microsoft.com/l/x")).toBe("Teams");
    expect(conferenceProviderLabel("https://meet.google.com/x")).toBe("Meet");
    expect(conferenceProviderLabel("https://whereby.com/x")).toBe("Video call");
    expect(conferenceProviderLabel(null)).toBeNull();
  });
});

describe("resolveCalendarEvent", () => {
  it("drops events we must not act on", () => {
    expect(resolveCalendarEvent(event({ status: "cancelled" }))).toBeNull();
    expect(
      resolveCalendarEvent(
        event({ attendees: [{ email: "me@x.com", self: true, responseStatus: "declined" }] }),
      ),
    ).toBeNull();
    // all-day: `date`, not `dateTime`
    expect(resolveCalendarEvent(event({ start: { date: "2026-07-30" } }))).toBeNull();
    expect(resolveCalendarEvent(event({ start: { dateTime: "not-a-date" } }))).toBeNull();
    expect(resolveCalendarEvent("nonsense")).toBeNull();
  });

  it("keeps an event someone else declined", () => {
    const resolved = resolveCalendarEvent(
      event({ attendees: [{ email: "them@x.com", responseStatus: "declined" }] }),
    );
    expect(resolved?.id).toBe("evt-1");
  });

  it("tolerates a missing end", () => {
    const resolved = resolveCalendarEvent(event({ end: undefined }));
    expect(resolved?.end).toBeNull();
  });

  it("falls back to the filename id and a placeholder title", () => {
    const resolved = resolveCalendarEvent(event({ id: undefined, summary: "  " }), "from-file");
    expect(resolved?.id).toBe("from-file");
    expect(resolved?.summary).toBe("(No title)");
  });
});

describe("time predicates", () => {
  const resolved = resolveCalendarEvent(event())!;

  it("isEventNow spans start inclusive to end exclusive", () => {
    expect(isEventNow(resolved, T0 - 1)).toBe(false);
    expect(isEventNow(resolved, T0)).toBe(true);
    expect(isEventNow(resolved, T0 + 30 * 60_000 - 1)).toBe(true);
    expect(isEventNow(resolved, T0 + 30 * 60_000)).toBe(false);
  });

  it("assumes 30 minutes when the event has no end", () => {
    const open = resolveCalendarEvent(event({ end: undefined }))!;
    expect(isEventNow(open, T0 + 29 * 60_000)).toBe(true);
    expect(isEventNow(open, T0 + 31 * 60_000)).toBe(false);
  });

  it("never treats an all-day event as now", () => {
    expect(isEventNow({ start: new Date(T0), end: null, isAllDay: true }, T0)).toBe(false);
  });

  it("startsWithin accepts a window that straddles the start", () => {
    // The notifier's window: 30s of grace behind, 90s of lead ahead.
    expect(startsWithin(resolved, -30_000, 90_000, T0 - 90_000)).toBe(true);
    expect(startsWithin(resolved, -30_000, 90_000, T0 - 91_000)).toBe(false);
    expect(startsWithin(resolved, -30_000, 90_000, T0 + 30_000)).toBe(true);
    expect(startsWithin(resolved, -30_000, 90_000, T0 + 31_000)).toBe(false);
  });
});

describe("listCalendarEvents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cal-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, value: unknown): Promise<void> {
    await fs.writeFile(path.join(dir, name), JSON.stringify(value), "utf8");
  }

  it("returns [] when the calendar was never synced", async () => {
    expect(await listCalendarEvents(path.join(dir, "nope"))).toEqual([]);
  });

  it("sorts by start and skips sync state", async () => {
    await write(
      "b.json",
      event({ id: "b", start: { dateTime: new Date(T0 + 60_000).toISOString() } }),
    );
    await write("a.json", event({ id: "a" }));
    await write("sync_state.json", { token: "x" });
    await write("notes.txt", "ignored");
    expect((await listCalendarEvents(dir)).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("one corrupt file does not hide the rest of the calendar", async () => {
    await fs.writeFile(path.join(dir, "broken.json"), "{ not json", "utf8");
    await write("good.json", event({ id: "good" }));
    expect((await listCalendarEvents(dir)).map((e) => e.id)).toEqual(["good"]);
  });

  it("filters to the upcoming window and optionally to joinable events", async () => {
    await write("soon.json", event({ id: "soon", hangoutLink: "https://meet.google.com/a" }));
    await write("no-link.json", event({ id: "no-link" }));
    await write(
      "later.json",
      event({ id: "later", start: { dateTime: new Date(T0 + 60 * 60_000).toISOString() } }),
    );

    const due = await listUpcomingEvents({ latestMs: 90_000, now: T0 - 60_000 }, dir);
    expect(due.map((e) => e.id).sort()).toEqual(["no-link", "soon"]);

    const joinable = await listUpcomingEvents(
      { latestMs: 90_000, requireConferenceLink: true, now: T0 - 60_000 },
      dir,
    );
    expect(joinable.map((e) => e.id)).toEqual(["soon"]);
  });

  it("finds what is in progress right now", async () => {
    await write("running.json", event({ id: "running" }));
    await write(
      "over.json",
      event({
        id: "over",
        start: { dateTime: new Date(T0 - 3 * 60 * 60_000).toISOString() },
        end: { dateTime: new Date(T0 - 2 * 60 * 60_000).toISOString() },
      }),
    );
    const now = await listEventsInProgress({ now: T0 + 60_000 }, dir);
    expect(now.map((e) => e.id)).toEqual(["running"]);
  });
});
