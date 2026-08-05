import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeMeetingEvent } from "@x/shared/dist/meetings.js";
import { sessionMeta } from "./factories.testkit.js";

let tmpDir: string;
let calendarLink: typeof import("./calendar-link.js");

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rowboat-calendar-link-"));
  process.env.SOLOMON_WORKDIR = tmpDir;
  vi.resetModules();
  calendarLink = await import("./calendar-link.js");
}, 30000);

afterAll(async () => {
  await fs
    .rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(() => {});
  delete process.env.SOLOMON_WORKDIR;
});

beforeEach(async () => {
  await fs.rm(path.join(tmpDir, "calendar_sync"), { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(path.join(tmpDir, "calendar_sync"), { recursive: true });
});

async function writeCachedEvent(id: string, event: Record<string, unknown>): Promise<void> {
  await fs.writeFile(
    path.join(tmpDir, "calendar_sync", `${id}.json`),
    JSON.stringify({ id, ...event }),
    "utf8",
  );
}

function meta(calendarEvent: unknown, started = "2026-08-04T15:00:00.000Z") {
  return { started, calendar_event: JSON.stringify(calendarEvent) };
}

describe("normalizeMeetingEvent", () => {
  it("keeps only the fields meta.json is meant to store", () => {
    const raw = {
      id: "evt_1",
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:00:00Z" },
      end: { dateTime: "2026-08-04T15:30:00Z" },
      // Everything below is what the deeplink path used to persist wholesale.
      description: "Internal notes, pricing, and a dial-in PIN",
      attachments: [{ fileId: "abc", title: "Contract.pdf" }],
      recurrence: ["RRULE:FREQ=WEEKLY"],
      etag: '"12345"',
    };

    const normalized = normalizeMeetingEvent(raw, { calendarId: "primary", source: "google" });

    expect(normalized).toEqual({
      id: "evt_1",
      calendarId: "primary",
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:00:00Z" },
      end: { dateTime: "2026-08-04T15:30:00Z" },
      source: "google",
    });
    expect(normalized).not.toHaveProperty("description");
    expect(normalized).not.toHaveProperty("attachments");
  });

  it("falls back to a supplied id when the payload has none", () => {
    expect(normalizeMeetingEvent({ summary: "x" }, { fallbackId: "evt_2" })?.id).toBe("evt_2");
  });

  it("keeps a good attendee when a sibling entry is malformed", () => {
    const normalized = normalizeMeetingEvent({
      summary: "x",
      attendees: [null, { email: "a@acme.com", responseStatus: "accepted", optional: true }],
    });
    expect(normalized?.attendees).toEqual([
      { email: "a@acme.com", optional: true, responseStatus: "accepted" },
    ]);
  });

  it("is undefined for input that carries nothing", () => {
    expect(normalizeMeetingEvent(null)).toBeUndefined();
    expect(normalizeMeetingEvent("nope")).toBeUndefined();
    expect(normalizeMeetingEvent({})).toBeUndefined();
  });
});

describe("resolveCalendarEventId", () => {
  it("prefers the id already stored on the session", async () => {
    await writeCachedEvent("evt_other", {
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:00:00Z" },
    });
    const id = await calendarLink.resolveCalendarEventId(
      meta({ id: "evt_stored", summary: "Acme sync" }),
    );
    expect(id).toBe("evt_stored");
  });

  it("recovers a unique match on title and start time", async () => {
    await writeCachedEvent("evt_1", {
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:05:00Z" },
    });
    await writeCachedEvent("evt_2", {
      summary: "Totally different",
      start: { dateTime: "2026-08-04T15:00:00Z" },
    });

    const id = await calendarLink.resolveCalendarEventId(meta({ summary: "Acme sync" }));
    expect(id).toBe("evt_1");
  });

  /**
   * A recurring meeting has the same title every week. Guessing one would make two
   * unrelated sessions share an observation identity and dedupe each other away.
   */
  it("declines when two cached events match", async () => {
    await writeCachedEvent("evt_1", {
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:00:00Z" },
    });
    await writeCachedEvent("evt_2", {
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:10:00Z" },
    });

    expect(await calendarLink.resolveCalendarEventId(meta({ summary: "Acme sync" }))).toBeUndefined();
  });

  it("declines when the only same-title event is outside the tolerance", async () => {
    await writeCachedEvent("evt_1", {
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T18:00:00Z" },
    });
    expect(await calendarLink.resolveCalendarEventId(meta({ summary: "Acme sync" }))).toBeUndefined();
  });

  it("declines when there is no calendar context at all", async () => {
    expect(
      await calendarLink.resolveCalendarEventId({ started: "2026-08-04T15:00:00.000Z" }),
    ).toBeUndefined();
  });

  it("ignores sync_state.json", async () => {
    await fs.writeFile(
      path.join(tmpDir, "calendar_sync", "sync_state.json"),
      JSON.stringify({ summary: "Acme sync", start: { dateTime: "2026-08-04T15:00:00Z" } }),
      "utf8",
    );
    expect(await calendarLink.resolveCalendarEventId(meta({ summary: "Acme sync" }))).toBeUndefined();
  });
});

describe("backfillCalendarEventId", () => {
  async function session(name: string, metaValue: object): Promise<string> {
    const dir = path.join(tmpDir, "recordings", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(metaValue), "utf8");
    return dir;
  }

  const baseMeta = sessionMeta({
    started: "2026-08-04T15:00:00.000Z",
    ended: "2026-08-04T15:30:00.000Z",
    duration_seconds: 1800,
  });

  it("writes the recovered id back and is idempotent", async () => {
    await writeCachedEvent("evt_1", {
      summary: "Acme sync",
      start: { dateTime: "2026-08-04T15:00:00Z" },
    });
    const dir = await session("2026.08.04-1500", {
      ...baseMeta,
      calendar_event: JSON.stringify({ summary: "Acme sync" }),
    });

    expect(await calendarLink.backfillCalendarEventId(dir)).toBe("evt_1");

    const written = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
    expect(JSON.parse(written.calendar_event).id).toBe("evt_1");
    // Every other field of meta.json survives the rewrite.
    expect(written.started).toBe(baseMeta.started);
    expect(written.duration_seconds).toBe(1800);

    expect(await calendarLink.backfillCalendarEventId(dir)).toBe("evt_1");
  });

  it("leaves meta.json untouched when nothing can be recovered", async () => {
    const dir = await session("2026.08.04-1600", {
      ...baseMeta,
      calendar_event: JSON.stringify({ summary: "Unmatched" }),
    });
    const before = await fs.readFile(path.join(dir, "meta.json"), "utf8");

    expect(await calendarLink.backfillCalendarEventId(dir)).toBeUndefined();
    expect(await fs.readFile(path.join(dir, "meta.json"), "utf8")).toBe(before);
  });
});
