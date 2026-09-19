// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "@/quality/test-support/render-query";

import { CommunicationPrivacySettings } from "./communication-privacy-settings";

vi.mock("@/lib/revenue", () => ({
  getCommunicationPolicy: vi.fn(),
  listCommunicationPrivacyRules: vi.fn(async () => []),
  putCommunicationPolicy: vi.fn(),
  createCommunicationPrivacyRule: vi.fn(),
  deleteCommunicationPrivacyRule: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommunicationPrivacySettings", () => {
  it("renders the mailbox privacy controls shell", () => {
    renderWithQuery(<CommunicationPrivacySettings />);
    expect(screen.getByText("Mailbox account")).toBeInTheDocument();
    expect(screen.getByLabelText("Mailbox account email")).toBeInTheDocument();
  });
});
