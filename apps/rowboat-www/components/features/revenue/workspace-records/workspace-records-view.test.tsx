import { describe, expect, it } from "vitest";

import { collapseWorkspaceNotes, plateText } from "@/lib/revenue-records";
import type { RelationshipObservation, RevenueRelationship } from "@/types/revenue";

const relationship = {
  id: "relationship-1",
  displayName: "Acme",
} as RevenueRelationship;

const observation = (
  externalId: string,
  occurredAt: string,
  eventType: "note" | "note_deleted",
  facts: Record<string, unknown>,
) =>
  ({
    externalId,
    occurredAt,
    eventType,
    normalizedFacts: facts,
    source: "desktop_note",
  }) as RelationshipObservation;

describe("workspace record notes", () => {
  it("keeps the latest version and hides deleted notes", () => {
    const notes = collapseWorkspaceNotes(
      [relationship],
      [
        [
          observation("event-1", "2026-09-01T12:00:00Z", "note", {
            noteId: "note-1",
            title: "Original",
          }),
          observation("event-2", "2026-09-02T12:00:00Z", "note", {
            noteId: "note-1",
            title: "Updated",
          }),
          observation("event-3", "2026-09-03T12:00:00Z", "note", {
            noteId: "note-2",
            title: "Delete me",
          }),
          observation("event-4", "2026-09-04T12:00:00Z", "note_deleted", {
            noteId: "note-2",
          }),
        ],
      ],
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ externalId: "note-1", title: "Updated" });
  });

  it("keeps Plate blocks readable in note previews", () => {
    expect(
      plateText([
        { type: "p", children: [{ text: "First line" }] },
        { type: "p", children: [{ text: "Second " }, { text: "line" }] },
      ]),
    ).toBe("First line\nSecond line");
  });
});
