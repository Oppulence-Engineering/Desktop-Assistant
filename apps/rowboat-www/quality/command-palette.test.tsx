// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const revenue = vi.hoisted(() => ({
  listRelationships: vi.fn(),
  semanticSearch: vi.fn(),
}));

vi.mock("@/lib/revenue", () => revenue);
vi.mock("@/components/app-shell", () => ({
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

import { CommandPalette } from "@/components/command-palette";

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
    revenue.semanticSearch.mockResolvedValue({
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

    render(<CommandPalette {...requiredProps} />);
    await user.click(screen.getByRole("button", { name: /search mail/i }));
    await user.type(screen.getByRole("textbox", { name: "Command search" }), "launch promise");

    await waitFor(() => {
      expect(revenue.semanticSearch).toHaveBeenCalledWith(
        "launch promise",
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText("Launch follow-up")).toBeVisible();
    expect(screen.getByText(/Ada · commitment · 91%/)).toBeVisible();
  });

  it("distinguishes an unavailable workspace capability from a search failure", async () => {
    const user = userEvent.setup();
    revenue.semanticSearch.mockResolvedValue({ available: false, matches: [] });

    render(<CommandPalette {...requiredProps} />);
    await user.click(screen.getByRole("button", { name: /search mail/i }));
    await user.type(screen.getByRole("textbox", { name: "Command search" }), "renewal risk");

    expect(
      await screen.findByText("Semantic mail search is not enabled for this workspace."),
    ).toBeVisible();
  });
});
