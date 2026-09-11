// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listComposioToolkits: vi.fn(),
  listComposioConnections: vi.fn(),
  startComposioConnection: vi.fn(),
  disconnectComposio: vi.fn(),
  UnconfiguredError: class extends Error {},
}));

vi.mock("@/lib/api/composio/client", () => ({
  listComposioToolkits: mocks.listComposioToolkits,
  listComposioConnections: mocks.listComposioConnections,
  startComposioConnection: mocks.startComposioConnection,
  disconnectComposio: mocks.disconnectComposio,
  ComposioUnconfiguredError: mocks.UnconfiguredError,
}));

import { ComposioConnections } from "./composio-connections";

afterEach(cleanup);

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }
  mocks.listComposioToolkits.mockResolvedValue([
    { slug: "jira", name: "Jira", managedAuth: true },
    { slug: "asana", name: "Asana", managedAuth: true },
  ]);
  mocks.listComposioConnections.mockResolvedValue([]);
});

describe("Composio connections", () => {
  it("offers a connect action for each product that is not linked", async () => {
    render(<ComposioConnections />);

    expect(await screen.findByText("Jira")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(2);
  });

  // The account is linked on Composio's page, not here, so the click must hand
  // the user that page rather than claim the product is connected.
  it("opens the hosted authorization page rather than connecting in place", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mocks.startComposioConnection.mockResolvedValue({
      connectionId: "ca_1",
      redirectUrl: "https://connect.composio.dev/link/lk_1",
      expiresAt: "",
    });
    render(<ComposioConnections />);
    await screen.findByText("Jira");

    await userEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]);

    expect(mocks.startComposioConnection).toHaveBeenCalledWith("jira");
    expect(open).toHaveBeenCalledWith(
      "https://connect.composio.dev/link/lk_1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("offers disconnect for a linked product and reloads after it", async () => {
    mocks.listComposioConnections.mockResolvedValue([
      { id: "ca_1", toolkit: "jira", status: "ACTIVE", createdAt: "" },
    ]);
    mocks.disconnectComposio.mockResolvedValue(undefined);
    render(<ComposioConnections />);

    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect(mocks.disconnectComposio).toHaveBeenCalledWith("ca_1");
    expect(mocks.listComposioConnections).toHaveBeenCalledTimes(2);
  });

  // A deployment with no project key has nothing to offer. An empty panel would
  // read as a broken feature rather than one that was never switched on.
  it("renders nothing when the server holds no project key", async () => {
    mocks.listComposioToolkits.mockRejectedValue(new mocks.UnconfiguredError());
    const { container } = render(<ComposioConnections />);

    await vi.waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("says so when the products cannot be loaded", async () => {
    mocks.listComposioToolkits.mockRejectedValue(new Error("upstream"));
    render(<ComposioConnections />);

    expect(await screen.findByText("Could not load products.")).toBeInTheDocument();
  });
});
