// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dashboardFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({
  dashboardFetch: (...args: unknown[]) => dashboardFetch(...args),
}));

import { DeleteAccountRow } from "./delete-account-row";

const assign = vi.fn();
const SUBMIT = "Permanently delete account";
const CONFIRM_LABEL = "Type DELETE to confirm";
const DELETED_TITLE = "Your account is deleted";
const SUCCESSOR_MESSAGE = "Remove the other members first";
const BILLING_MESSAGE = "We could not cancel your subscription, so your account was not deleted.";
const FALLBACK_MESSAGE = "We could not delete your account. Try again, or contact support.";
const RECEIPT = {
  receiptId: "d3ba394b-873b-4219-8cf9-809e9f10aafb",
  requestedAt: "2026-09-15T21:29:01Z",
  completedAt: "2026-09-15T21:29:07Z",
  identityDeleted: true,
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
});

afterEach(() => {
  cleanup();
  dashboardFetch.mockReset();
  assign.mockReset();
});

async function openSheet() {
  const user = userEvent.setup();
  render(<DeleteAccountRow />);
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  return user;
}

async function confirmAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(CONFIRM_LABEL), "DELETE");
  await user.click(screen.getByRole("button", { name: SUBMIT }));
}

describe("DeleteAccountRow", () => {
  describe("before the sheet opens", () => {
    it("shows only the row and sends nothing", () => {
      render(<DeleteAccountRow />);
      expect(screen.getByText("Delete account", { selector: "p" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(CONFIRM_LABEL)).not.toBeInTheDocument();
      expect(dashboardFetch).not.toHaveBeenCalled();
    });

    it("marks the row with its component slot", () => {
      const { container } = render(<DeleteAccountRow />);
      expect(container.querySelector('[data-slot="delete-account-row"]')).not.toBeNull();
    });
  });

  describe("the confirmation sheet", () => {
    it("explains every consequence before the user confirms", async () => {
      await openSheet();
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Delete your account")).toBeInTheDocument();
      expect(within(dialog).getByText("You cannot undo this.")).toBeInTheDocument();
      expect(within(dialog).getByText(/cancel your subscription immediately/i)).toBeInTheDocument();
      expect(within(dialog).getByText(/disconnect your connected accounts/i)).toBeInTheDocument();
      expect(
        within(dialog).getByText(/shared workspace goes to another member/i),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/cannot sign in to this account again/i)).toBeInTheDocument();
    });

    it("starts with an empty confirmation and a disabled delete button", async () => {
      await openSheet();
      expect(screen.getByLabelText(CONFIRM_LABEL)).toHaveValue("");
      expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    });

    it.each(["delete", "Delete", "DELETE ", " DELETE", "DELET", "DELETEX", "D E L E T E"])(
      "keeps the delete disabled for %j",
      async (typed) => {
        const user = await openSheet();
        await user.type(screen.getByLabelText(CONFIRM_LABEL), typed);
        expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
        expect(dashboardFetch).not.toHaveBeenCalled();
      },
    );

    it("enables the delete only for the exact word DELETE", async () => {
      const user = await openSheet();
      await user.type(screen.getByLabelText(CONFIRM_LABEL), "DELETE");
      expect(screen.getByRole("button", { name: SUBMIT })).toBeEnabled();
    });

    it("disables the delete again when the user edits the word", async () => {
      const user = await openSheet();
      const input = screen.getByLabelText(CONFIRM_LABEL);
      await user.type(input, "DELETE");
      await user.type(input, "{Backspace}");
      expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    });

    it("clears the confirmation and the error when the user closes the sheet", async () => {
      dashboardFetch.mockResolvedValue(json(409, { code: "workspace_successor_required" }));
      const user = await openSheet();
      await confirmAndSubmit(user);
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Delete account" }));
      expect(screen.getByLabelText(CONFIRM_LABEL)).toHaveValue("");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe("a successful deletion", () => {
    it("sends DELETE /v1/me with a JSON confirmation body", async () => {
      dashboardFetch.mockResolvedValue(json(200, RECEIPT));
      const user = await openSheet();
      await confirmAndSubmit(user);

      await waitFor(() => expect(dashboardFetch).toHaveBeenCalledTimes(1));
      const [url, init] = dashboardFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/rowboat/v1/me");
      expect(init.method).toBe("DELETE");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body as string)).toEqual({ confirm: "DELETE" });
    });

    it("shows the receipt and keeps the user on the page until they sign out", async () => {
      dashboardFetch.mockResolvedValue(json(200, RECEIPT));
      const user = await openSheet();
      await confirmAndSubmit(user);

      const dialog = await screen.findByRole("dialog");
      expect(await within(dialog).findByText(DELETED_TITLE)).toBeInTheDocument();
      expect(within(dialog).getByText(RECEIPT.receiptId)).toBeInTheDocument();
      expect(within(dialog).getByText(RECEIPT.completedAt)).toBeInTheDocument();
      expect(within(dialog).queryByLabelText(CONFIRM_LABEL)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
    });

    it("signs the user out through the logout route from the receipt", async () => {
      dashboardFetch.mockResolvedValue(json(200, RECEIPT));
      const user = await openSheet();
      await confirmAndSubmit(user);

      await user.click(await screen.findByRole("button", { name: "Sign out" }));
      expect(assign).toHaveBeenCalledWith("/api/auth/logout");
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it("signs the user out when they close the receipt", async () => {
      dashboardFetch.mockResolvedValue(json(200, RECEIPT));
      const user = await openSheet();
      await confirmAndSubmit(user);
      await screen.findByText(DELETED_TITLE);

      await user.keyboard("{Escape}");
      expect(assign).toHaveBeenCalledWith("/api/auth/logout");
    });

    it.each([
      ["an empty body", {}],
      ["a receipt without a completion time", { receiptId: "r1" }],
      ["an empty receipt id", { receiptId: "", completedAt: "2026-09-15T21:29:07Z" }],
    ])("signs the user out at once for %s", async (_label, body) => {
      dashboardFetch.mockResolvedValue(json(200, body));
      const user = await openSheet();
      await confirmAndSubmit(user);
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/auth/logout"));
      expect(screen.queryByText(DELETED_TITLE)).not.toBeInTheDocument();
    });

    it("signs the user out at once when the success body is not JSON", async () => {
      dashboardFetch.mockResolvedValue(new Response("ok", { status: 200 }));
      const user = await openSheet();
      await confirmAndSubmit(user);
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/auth/logout"));
    });

    it("shows progress and ignores a second click while the request runs", async () => {
      let finish: (response: Response) => void = () => undefined;
      dashboardFetch.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
      const user = await openSheet();
      await confirmAndSubmit(user);

      const pendingButton = await screen.findByRole("button", { name: "Deleting…" });
      expect(pendingButton).toBeDisabled();
      await user.click(pendingButton);
      expect(dashboardFetch).toHaveBeenCalledTimes(1);

      finish(json(200, RECEIPT));
      expect(await screen.findByText(DELETED_TITLE)).toBeInTheDocument();
    });
  });

  describe("a refused or failed deletion", () => {
    it.each([
      [409, { code: "workspace_successor_required" }, SUCCESSOR_MESSAGE],
      [502, { code: "billing_cancellation_failed" }, BILLING_MESSAGE],
      [400, { code: "confirmation_required" }, FALLBACK_MESSAGE],
      [500, { code: "internal_error" }, FALLBACK_MESSAGE],
      [500, { code: "connector_revocation_failed" }, FALLBACK_MESSAGE],
      [429, { code: "rate_limited" }, FALLBACK_MESSAGE],
      [401, {}, FALLBACK_MESSAGE],
    ])(
      "maps HTTP %i %j to a message and keeps the user signed in",
      async (status, body, message) => {
        dashboardFetch.mockResolvedValue(json(status, body));
        const user = await openSheet();
        await confirmAndSubmit(user);

        expect(await screen.findByRole("alert")).toHaveTextContent(message);
        expect(assign).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.queryByText(DELETED_TITLE)).not.toBeInTheDocument();
      },
    );

    it("falls back to a generic message when the error body is not JSON", async () => {
      dashboardFetch.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
      const user = await openSheet();
      await confirmAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(FALLBACK_MESSAGE);
      expect(assign).not.toHaveBeenCalled();
    });

    it("falls back to a generic message when the network request fails", async () => {
      dashboardFetch.mockRejectedValue(new TypeError("Failed to fetch"));
      const user = await openSheet();
      await confirmAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(FALLBACK_MESSAGE);
      expect(assign).not.toHaveBeenCalled();
    });

    it("never shows the raw problem code to the user", async () => {
      dashboardFetch.mockResolvedValue(json(409, { code: "workspace_successor_required" }));
      const user = await openSheet();
      await confirmAndSubmit(user);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toContain("workspace_successor_required");
    });

    it("re-enables the delete after a failure so the user can retry", async () => {
      dashboardFetch.mockResolvedValue(json(502, { code: "billing_cancellation_failed" }));
      const user = await openSheet();
      await confirmAndSubmit(user);
      await screen.findByRole("alert");
      expect(screen.getByRole("button", { name: SUBMIT })).toBeEnabled();
      expect(screen.getByLabelText(CONFIRM_LABEL)).toHaveValue("DELETE");
    });

    it("clears the old error and shows the receipt when the retry succeeds", async () => {
      dashboardFetch
        .mockResolvedValueOnce(json(502, { code: "billing_cancellation_failed" }))
        .mockResolvedValueOnce(json(200, RECEIPT));
      const user = await openSheet();
      await confirmAndSubmit(user);
      await screen.findByRole("alert");

      await user.click(screen.getByRole("button", { name: SUBMIT }));
      expect(await screen.findByText(DELETED_TITLE)).toBeInTheDocument();
      expect(dashboardFetch).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
