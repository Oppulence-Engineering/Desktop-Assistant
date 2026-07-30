import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listCalendarEvents } from "./calendar_events.js";

/**
 * `calendar_sync/` is written by a background sync and read by a loop that must never
 * die. Everything in here is a real thing that can end up in that folder — a partial
 * write, a provider field of the wrong type, a directory someone made by hand — and any
 * one of them taking the whole calendar down with it would silently stop every meeting
 * reminder.
 */

describe("calendar reader survives whatever is in the folder", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cal-adv-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = (name: string, body: string) => fs.writeFile(path.join(dir, name), body, "utf8");
  const good = JSON.stringify({
    id: "ok",
    summary: "Real",
    start: { dateTime: "2026-07-30T15:00:00Z" },
  });

  it("valid events survive every kind of neighbour", async () => {
    await write("ok.json", good);
    await write("empty.json", "");
    await write("null.json", "null");
    await write("array.json", "[1,2,3]");
    await write("string.json", '"just a string"');
    await write("number.json", "42");
    await write("truncated.json", '{"id":"x","start":{"dateT');
    await write("deep.json", JSON.stringify({ id: "d", start: { dateTime: 1234 } }));
    await write(
      "nullattendee.json",
      JSON.stringify({
        id: "na",
        start: { dateTime: "2026-07-30T15:00:00Z" },
        attendees: [null],
      }),
    );
    await write(
      "bigsummary.json",
      JSON.stringify({
        id: "big",
        summary: "x".repeat(100000),
        start: { dateTime: "2026-07-30T15:00:00Z" },
      }),
    );
    await fs.mkdir(path.join(dir, "subdir.json"));

    const ids = (await listCalendarEvents(dir)).map((e) => e.id).sort();
    // `na` is the one that matters: an event whose attendee list holds a junk element
    // must not be dropped. A strict array would reject the whole event, costing that
    // meeting its reminder over a field nothing here depends on being complete.
    expect(ids).toEqual(["big", "na", "ok"]);
  });

  it("a directory that looks like an event file is not one", async () => {
    await fs.mkdir(path.join(dir, "notreally.json"));
    await write("ok.json", good);
    expect((await listCalendarEvents(dir)).map((e) => e.id)).toEqual(["ok"]);
  });
});
