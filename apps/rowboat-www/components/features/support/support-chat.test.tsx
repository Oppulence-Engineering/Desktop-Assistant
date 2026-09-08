// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupportChat } from "@/components/features/support/support-chat";

const mocks = vi.hoisted(() => ({
  loadSupportChatConfig: vi.fn(),
}));

vi.mock("@/lib/api/support/chat", () => ({
  loadSupportChatConfig: mocks.loadSupportChatConfig,
}));

const init = vi.fn();
const setCustomerDetails = vi.fn();
const isInitialized = vi.fn(() => false);

/**
 * Stands in for Plain's CDN script: the real tag never loads under jsdom, so
 * the test installs window.Plain and resolves the injected script's load event.
 */
function stubPlainScript() {
  const appendChild = HTMLHeadElement.prototype.appendChild;
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    const result = appendChild.call(document.head, node) as typeof node;
    if (node instanceof HTMLScriptElement) {
      window.Plain = { init, isInitialized, setCustomerDetails };
      queueMicrotask(() => node.dispatchEvent(new Event("load")));
    }
    return result;
  });
}

describe("SupportChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.getElementById("plain-chat")?.remove();
    delete window.Plain;
    isInitialized.mockReturnValue(false);
    stubPlainScript();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders no visible UI, since Plain draws its own launcher", () => {
    mocks.loadSupportChatConfig.mockResolvedValue({ configured: false });

    const { container } = render(<SupportChat />);

    const root = container.querySelector('[data-slot="support-chat"]');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("never loads the vendor script when no chat app is configured", async () => {
    mocks.loadSupportChatConfig.mockResolvedValue({ configured: false });

    render(<SupportChat />);

    await waitFor(() => expect(mocks.loadSupportChatConfig).toHaveBeenCalled());
    expect(document.getElementById("plain-chat")).toBeNull();
    expect(init).not.toHaveBeenCalled();
  });

  it("boots the widget anonymously for visitors without an identity", async () => {
    mocks.loadSupportChatConfig.mockResolvedValue({ configured: true, appId: "app-1" });

    render(<SupportChat theme="dark" />);

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const options = init.mock.calls[0][0] as Record<string, unknown>;
    expect(options.appId).toBe("app-1");
    expect(options.theme).toBe("dark");
    expect(options.customerDetails).toBeUndefined();
  });

  it("passes the server-signed identity through for signed-in users", async () => {
    mocks.loadSupportChatConfig.mockResolvedValue({
      configured: true,
      appId: "app-1",
      customer: { email: "user@example.com", emailHash: "deadbeef" },
    });

    render(<SupportChat />);

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const options = init.mock.calls[0][0] as Record<string, unknown>;
    expect(options.customerDetails).toEqual({
      email: "user@example.com",
      emailHash: "deadbeef",
    });
  });

  it("updates identity in place instead of re-initializing an existing widget", async () => {
    isInitialized.mockReturnValue(true);
    mocks.loadSupportChatConfig.mockResolvedValue({
      configured: true,
      appId: "app-1",
      customer: { email: "user@example.com", emailHash: "deadbeef" },
    });

    render(<SupportChat />);

    await waitFor(() => expect(setCustomerDetails).toHaveBeenCalledTimes(1));
    expect(init).not.toHaveBeenCalled();
  });

  it("labels every thread the widget opens, so support can filter by brand", async () => {
    mocks.loadSupportChatConfig.mockResolvedValue({
      configured: true,
      appId: "app-1",
      labelTypeIds: ["lt_brand"],
    });

    render(<SupportChat />);

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const options = init.mock.calls[0][0] as Record<string, unknown>;
    expect(options.threadDetails).toEqual({ labelTypeIds: ["lt_brand"] });
  });

  it("omits threadDetails when no labels are configured", async () => {
    mocks.loadSupportChatConfig.mockResolvedValue({ configured: true, appId: "app-1" });

    render(<SupportChat />);

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const options = init.mock.calls[0][0] as Record<string, unknown>;
    expect(options.threadDetails).toBeUndefined();
  });

  it("stays silent when the config request fails", async () => {
    mocks.loadSupportChatConfig.mockRejectedValue(new Error("offline"));

    render(<SupportChat />);

    await waitFor(() => expect(mocks.loadSupportChatConfig).toHaveBeenCalled());
    expect(init).not.toHaveBeenCalled();
  });
});
