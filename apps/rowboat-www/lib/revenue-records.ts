import type { RelationshipObservation, RevenueRelationship } from "@/types/revenue";

export type WorkspaceNote = {
  externalId: string;
  title: string;
  body: string;
  content?: unknown;
  meetingLinked?: boolean;
  relationshipId: string;
  relationshipName: string;
  occurredAt: string;
  eventType: string;
};

const nodeText = (node: unknown): string => {
  if (!node || typeof node !== "object") return "";
  if ("text" in node) return String(node.text || "");
  if (!("children" in node) || !Array.isArray(node.children)) return "";
  return node.children.map(nodeText).join("");
};

export const plateText = (value: unknown) =>
  Array.isArray(value) ? value.map(nodeText).join("\n").trimEnd() : "";

export function collapseWorkspaceNotes(
  relationships: RevenueRelationship[],
  timelines: RelationshipObservation[][],
): WorkspaceNote[] {
  const latest = new Map<string, WorkspaceNote>();
  timelines.forEach((observations, index) =>
    observations.forEach((observation) => {
      if (
        observation.source !== "desktop_note" ||
        !["note", "note_deleted"].includes(observation.eventType)
      )
        return;
      const noteId = String(observation.normalizedFacts.noteId || observation.externalId);
      const current = latest.get(noteId);
      if (current && current.occurredAt >= observation.occurredAt) return;
      latest.set(noteId, {
        externalId: noteId,
        title: String(observation.normalizedFacts.title || observation.summary || "Untitled"),
        body: String(observation.normalizedFacts.body || ""),
        content: observation.normalizedFacts.content,
        meetingLinked: Boolean(observation.normalizedFacts.meetingLinked),
        relationshipId: relationships[index].id,
        relationshipName: relationships[index].displayName,
        occurredAt: observation.occurredAt,
        eventType: observation.eventType,
      });
    }),
  );
  return [...latest.values()]
    .filter((note) => note.eventType === "note")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
