// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRAPH_VIEWS_MIGRATED_KEY,
  LEGACY_GRAPH_VIEWS_KEY,
  graphSavedViews,
  migrateLegacyGraphViews,
  noteFavorites,
  noteTemplates,
} from "@/lib/console/console-resources";
import type { ConsoleResource } from "@/lib/console/console";

const state = {
  scope: "portfolio" as const,
  query: "",
  layout: "force" as const,
  density: 0.72,
  hideIsolated: false,
  focusDepth: 0 as const,
  changedSinceReview: false,
};
const timestamps = {
  createdAt: "2026-09-17T12:00:00Z",
  updatedAt: "2026-09-17T12:00:00Z",
  sortOrder: 0,
};

describe("console resource projections", () => {
  let values: Map<string, string>;
  let storage: Pick<Storage, "getItem" | "setItem">;

  beforeEach(() => {
    values = new Map();
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  });

  it("separates templates and favorites by validated payload shape", () => {
    const resources: ConsoleResource[] = [
      {
        ...timestamps,
        id: "11111111-1111-4111-8111-111111111111",
        kind: "note_template",
        name: "Review",
        payload: { title: "Review", body: "Agenda" },
      },
      {
        ...timestamps,
        id: "22222222-2222-4222-8222-222222222222",
        kind: "note_favorite",
        payload: { noteId: "note-1" },
      },
    ];

    expect(noteTemplates(resources)[0]?.payload.title).toBe("Review");
    expect(noteFavorites(resources)[0]?.payload.noteId).toBe("note-1");
  });

  it("imports each legacy graph view once and marks completion", async () => {
    storage.setItem(
      LEGACY_GRAPH_VIEWS_KEY,
      JSON.stringify([
        {
          id: "33333333-3333-4333-8333-333333333333",
          label: "Portfolio",
          createdAt: timestamps.createdAt,
          updatedAt: timestamps.updatedAt,
          state,
        },
      ]),
    );
    const create = vi.fn().mockResolvedValue(undefined);

    await expect(migrateLegacyGraphViews({ storage, remote: [], create })).resolves.toBe(true);
    await expect(migrateLegacyGraphViews({ storage, remote: [], create })).resolves.toBe(false);

    expect(create).toHaveBeenCalledTimes(1);
    expect(storage.getItem(GRAPH_VIEWS_MIGRATED_KEY)).toBe("true");
  });

  it("does not duplicate a matching remote graph view", async () => {
    storage.setItem(
      LEGACY_GRAPH_VIEWS_KEY,
      JSON.stringify([
        {
          id: "33333333-3333-4333-8333-333333333333",
          label: "Portfolio",
          createdAt: timestamps.createdAt,
          updatedAt: timestamps.updatedAt,
          state,
        },
      ]),
    );
    const remote = graphSavedViews([
      {
        ...timestamps,
        id: "44444444-4444-4444-8444-444444444444",
        kind: "graph_saved_view",
        name: "Portfolio",
        payload: { state },
      },
    ]);
    const create = vi.fn();

    await migrateLegacyGraphViews({ storage, remote, create });

    expect(create).not.toHaveBeenCalled();
  });
});
