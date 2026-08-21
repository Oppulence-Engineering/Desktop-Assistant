import { describe, expect, it } from "vitest";
import { formatMeetingNote } from "@x/shared/meetings";

/**
 * Meeting titles come from calendar invites, so anyone who can send the user one
 * controls the string. A newline in it used to end the `title:` line and turn everything
 * after into more frontmatter - letting an invite forge fields the app trusts.
 *
 * `session_id` is the sharpest of those: notes are matched to their recording session by
 * it, and an injected copy sorts above the real one. A forged value could make a session
 * disown its own note, or claim another meeting's.
 */

const sessionIds = (note: string) =>
  [...note.matchAll(/^session_id:\s*(.+)$/gm)].map((match) => match[1]);

const noteWithTitle = (summary: string) =>
  formatMeetingNote(
    [],
    "2026-07-29T10:00:00.000Z",
    { summary },
    { session_id: "2026.07.29-1000", capture_engine: "native" },
    "2026.07.29-1000",
  );

describe("frontmatter injection through a calendar title", () => {
  it.each([
    ["line feed", "\u000a"],
    ["carriage return", "\u000d"],
    ["CRLF", "\u000d\u000a"],
    ["next line", "\u0085"],
    ["vertical tab", "\u000b"],
    ["form feed", "\u000c"],
    ["null", "\u0000"],
    ["delete", "\u007f"],
  ])("a %s in the title cannot forge a session_id", (_label, separator) => {
    const note = noteWithTitle(`Standup${separator}session_id: 2026.07.29-9999`);
    expect(sessionIds(note)).toEqual(["2026.07.29-1000"]);
  });

  it("cannot forge any other frontmatter field either", () => {
    // `source: solomon` is what note listing filters on, and `type` drives rendering.
    const note = noteWithTitle("Standup\ntype: evil\nsource: elsewhere");
    expect(note.match(/^type:/gm)).toHaveLength(1);
    expect(note.match(/^source:/gm)).toHaveLength(1);
  });

  it("keeps the whole title on one line rather than dropping the rest", () => {
    // Flattened, not truncated - the user still sees what the invite was called.
    const note = noteWithTitle("Standup\nwith the platform team");
    expect(note).toContain("title: Standup with the platform team");
    expect(note.split("\n").filter((line) => line.startsWith("title: "))).toHaveLength(1);
  });

  it("falls back to a usable title when one is nothing but separators", () => {
    expect(noteWithTitle("\n\t  ")).toContain("title: Meeting Notes");
  });

  it("leaves an ordinary title, including its unicode, exactly as it was", () => {
    const note = noteWithTitle("Caf\u00e9 1:1 - Q3 planning");
    expect(note).toContain("title: Caf\u00e9 1:1 - Q3 planning");
  });
});
