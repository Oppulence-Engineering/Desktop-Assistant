// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchers = vi.hoisted(() => ({
  fetchRelationships: vi.fn(),
  fetchSemanticSearch: vi.fn(),
  fetchIdentityCandidates: vi.fn(),
  fetchRelationshipAttention: vi.fn(),
  fetchRelationshipGraph: vi.fn(),
  fetchPersons: vi.fn(),
}));

vi.mock("@/hooks/queries/utils/fetch-relationships", () => fetchers);
vi.mock("@oppulence/ui/components/spinner", () => ({
  Spinner: () => <span>Searching…</span>,
}));
vi.mock("@/components/features/dashboard/app-shell/app-shell", () => ({
  SETTINGS_SECTIONS: [],
  useThemePreference: () => ({ setTheme: vi.fn() }),
}));
vi.mock("@oppulence/ui/components/command", () => ({
  CommandDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children, heading }: { children: React.ReactNode; heading: string }) => (
    <section aria-label={heading}>{children}</section>
  ),
  CommandInput: ({
    onValueChange,
    placeholder,
    value,
  }: {
    onValueChange: (value: string) => void;
    placeholder: string;
    value: string;
  }) => (
    <input
      aria-label="Command search"
      onChange={(event) => {
        onValueChange(event.target.value);
      }}
      placeholder={placeholder}
      value={value}
    />
  ),
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandSeparator: () => <hr />,
  CommandShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { CommandPalette } from "@/components/features/dashboard/command-palette/command-palette";

function renderPalette(props: ComponentProps<typeof CommandPalette>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommandPalette {...props} />
    </QueryClientProvider>,
  );
}

const requiredProps = {
  agents: [],
  onNavigateChat: vi.fn(),
  onNewChat: vi.fn(),
  onOpenAgent: vi.fn(),
  onOpenChange: vi.fn(),
  onOpenSession: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleSidebar: vi.fn(),
  open: true,
  sessions: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommandPalette semantic mail search", () => {
  it("uses an explicit mail mode and renders evidence metadata", async () => {
    const user = userEvent.setup();
    fetchers.fetchSemanticSearch.mockResolvedValue({
      available: true,
      matches: [
        {
          classification: "commitment",
          counterparty: "Ada",
          score: 0.91,
          subject: "Launch follow-up",
          summary: "Ada promised the revised launch plan.",
          threadId: "thread-1",
        },
      ],
    });

    renderPalette(requiredProps);
    await user.click(screen.getByRole("button", { name: /search mail/i }));
    await user.type(screen.getByRole("textbox", { name: "Command search" }), "launch promise");

    await waitFor(() => {
      expect(fetchers.fetchSemanticSearch).toHaveBeenCalledWith(
        "launch promise",
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText("Launch follow-up")).toBeVisible();
    expect(screen.getByText(/Ada · commitment · 91%/)).toBeVisible();
  });

  it("distinguishes an unavailable workspace capability from a search failure", async () => {
    const user = userEvent.setup();
    fetchers.fetchSemanticSearch.mockResolvedValue({ available: false, matches: [] });

    renderPalette(requiredProps);
    await user.click(screen.getByRole("button", { name: /search mail/i }));
    await user.type(screen.getByRole("textbox", { name: "Command search" }), "renewal risk");

    expect(
      await screen.findByText("Semantic mail search is not enabled for this workspace."),
    ).toBeVisible();
  });
});
