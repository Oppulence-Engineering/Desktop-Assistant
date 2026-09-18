// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listConsoleResources: vi.fn(),
  listRelationships: vi.fn(),
  getRelationshipTimeline: vi.fn(),
}));

vi.mock("@/lib/console", () => ({
  createConsoleResource: vi.fn(),
  deleteConsoleResource: vi.fn(),
  listConsoleResources: mocks.listConsoleResources,
  patchConsoleResource: vi.fn(),
}));
vi.mock("@/lib/revenue", () => ({
  listRelationships: mocks.listRelationships,
  getRelationshipTimeline: mocks.getRelationshipTimeline,
  relativeTime: () => "now",
}));
vi.mock("@oppulence/ui/components/dialog", () => ({
  Dialog: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));

import { NotesView } from "@/components/features/revenue/workspace-records/workspace-records-view";

const timestamps = {
  createdAt: "2026-09-17T12:00:00Z",
  updatedAt: "2026-09-17T12:00:00Z",
  sortOrder: 0,
};

function renderNotes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotesView onError={vi.fn()} onNotice={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("durable note templates and favorites", () => {
  beforeEach(() => {
    mocks.listRelationships.mockResolvedValue([
      { id: "relationship-1", kind: "organization", displayName: "Acme" },
    ]);
    mocks.getRelationshipTimeline.mockResolvedValue([
      {
        source: "desktop_note",
        externalId: "event-1",
        eventType: "note",
        occurredAt: "2026-09-17T12:00:00Z",
        summary: "Account review",
        normalizedFacts: {
          noteId: "note-1",
          title: "Account review",
          body: "Follow up",
        },
      },
    ]);
    mocks.listConsoleResources.mockImplementation(async (kind: string) =>
      kind === "note_template"
        ? [
            {
              ...timestamps,
              id: "11111111-1111-4111-8111-111111111111",
              kind,
              name: "Weekly review",
              payload: { title: "Weekly review", body: "Wins and risks" },
            },
          ]
        : [
            {
              ...timestamps,
              id: "22222222-2222-4222-8222-222222222222",
              kind,
              payload: { noteId: "note-1" },
            },
          ],
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the real favorite count from durable resources", async () => {
    renderNotes();

    expect((await screen.findAllByText("Account review")).length).toBeGreaterThan(0);
    expect(screen.getByText("Favorites").parentElement).toHaveTextContent("1");
  });

  it("applies a durable template to a new note", async () => {
    const user = userEvent.setup();
    renderNotes();

    await user.click(await screen.findByRole("tab", { name: /Templates/ }));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    expect(await screen.findByDisplayValue("Weekly review")).toBeInTheDocument();
    expect(screen.getByText("Wins and risks")).toBeInTheDocument();
  });
});
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
            liveLinked: true,
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
    expect(notes[0]).toMatchObject({
      externalId: "note-1",
      title: "Updated",
      liveLinked: true,
    });
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
