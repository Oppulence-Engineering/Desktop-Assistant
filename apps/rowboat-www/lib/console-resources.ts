"use client";

import "client-only";

import {
  RelationshipGraphSavedViewSchema,
  RelationshipGraphSavedViewsSchema,
  type RelationshipGraphSavedView,
  type RelationshipGraphSavedViewState,
} from "@/types/revenue";
import type { ConsoleResource } from "@/lib/console";

export const LEGACY_GRAPH_VIEWS_KEY = "oppulence.relationship-graph.saved-views.v1";
export const GRAPH_VIEWS_MIGRATED_KEY = "oppulence.relationship-graph.saved-views.v2-imported";

export type NoteTemplateResource = ConsoleResource & {
  kind: "note_template";
  payload: { title: string; body?: string; content?: Array<Record<string, unknown>> };
};

export type NoteFavoriteResource = ConsoleResource & {
  kind: "note_favorite";
  payload: { noteId: string };
};

export type GraphSavedViewResource = ConsoleResource & {
  kind: "graph_saved_view";
  name: string;
  payload: { state: RelationshipGraphSavedViewState };
};

export const noteTemplates = (resources: ConsoleResource[]): NoteTemplateResource[] =>
  resources.filter(
    (resource): resource is NoteTemplateResource =>
      resource.kind === "note_template" && "title" in resource.payload,
  );

export const noteFavorites = (resources: ConsoleResource[]): NoteFavoriteResource[] =>
  resources.filter(
    (resource): resource is NoteFavoriteResource =>
      resource.kind === "note_favorite" && "noteId" in resource.payload,
  );

export const graphSavedViews = (resources: ConsoleResource[]): GraphSavedViewResource[] =>
  resources.filter(
    (resource): resource is GraphSavedViewResource =>
      resource.kind === "graph_saved_view" &&
      typeof resource.name === "string" &&
      "state" in resource.payload,
  );

export function readLegacyGraphViews(
  storage: Pick<Storage, "getItem">,
): RelationshipGraphSavedView[] {
  try {
    return RelationshipGraphSavedViewsSchema.parse(
      JSON.parse(storage.getItem(LEGACY_GRAPH_VIEWS_KEY) || "[]"),
    );
  } catch {
    return [];
  }
}

const savedViewFingerprint = (name: string, state: RelationshipGraphSavedViewState) =>
  JSON.stringify([name, state]);

/**
 * Imports legacy views only after the API is known to be available. Existing
 * fingerprints make retries safe if a previous import stopped midway.
 */
export async function migrateLegacyGraphViews({
  storage,
  remote,
  create,
}: {
  storage: Pick<Storage, "getItem" | "setItem">;
  remote: GraphSavedViewResource[];
  create: (view: RelationshipGraphSavedView) => Promise<unknown>;
}): Promise<boolean> {
  if (storage.getItem(GRAPH_VIEWS_MIGRATED_KEY) === "true") return false;

  const existing = new Set(
    remote.map((view) => savedViewFingerprint(view.name, view.payload.state)),
  );
  for (const candidate of readLegacyGraphViews(storage)) {
    const view = RelationshipGraphSavedViewSchema.parse(candidate);
    const fingerprint = savedViewFingerprint(view.label, view.state);
    if (!existing.has(fingerprint)) {
      await create(view);
      existing.add(fingerprint);
    }
  }
  storage.setItem(GRAPH_VIEWS_MIGRATED_KEY, "true");
  return true;
}
