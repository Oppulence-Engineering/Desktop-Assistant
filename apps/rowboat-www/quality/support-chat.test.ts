import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { DashboardSessionCookie } from "@/lib/auth/schemas";

const mocks = vi.hoisted(() => ({
  readSessionCookie: vi.fn(),
  fetchViewerIdentity: vi.fn(),
}));

vi.mock("@/lib/auth/cookies", () => ({
  readSessionCookie: mocks.readSessionCookie,
}));

vi.mock("@/lib/auth/rowboat-api", () => ({
  fetchViewerIdentity: mocks.fetchViewerIdentity,
}));

// connection() only works inside a real request scope; the route calls it to
// stay dynamic, which the production build asserts separately.
vi.mock("next/server", async () => ({
  ...(await vi.importActual<typeof import("next/server")>("next/server")),
  connection: vi.fn(() => Promise.resolve(undefined)),
}));

import { GET } from "@/app/api/support/chat/route";
import { emailHash } from "@/lib/support/config";
import { SupportChatConfigSchema } from "@/lib/api/support/chat";

const session: DashboardSessionCookie = {
  version: 1,
  accessToken: "access-token",
  tokenType: "Bearer",
  expiresAt: 2_000_000_000,
  createdAt: 1_999_999_000,
  updatedAt: 1_999_999_000,
  user: {
    workosUserId: "workos-user",
    email: "stale@example.com",
    organizationId: "org-1",
    permissions: [],
  },
};

function call() {
  return GET(new NextRequest("https://oppulence.io/api/support/chat"));
}

interface ChatConfigBody {
  configured: boolean;
  appId?: string;
  labelTypeIds?: string[];
  customer?: { email: string; emailHash: string };
}

/**
 * Reads the route body through the same schema the browser uses, so a
 * response shape the client would reject also fails the test.
 */
async function callJSON(): Promise<ChatConfigBody> {
  return SupportChatConfigSchema.parse(await (await call()).json());
}

describe("support chat config route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_APP_ID", "chat-app-id");
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_SECRET", "chat-secret");
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS", "lt_brand");
    mocks.readSessionCookie.mockReturnValue(null);
  });

  it("reports unconfigured when no chat app is set, so the script never loads", async () => {
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_APP_ID", "");

    await expect(callJSON()).resolves.toEqual({ configured: false });
  });

  it("serves the app id without an identity for anonymous visitors", async () => {
    const body = await callJSON();

    expect(body).toEqual({
      configured: true,
      appId: "chat-app-id",
      labelTypeIds: ["lt_brand"],
    });
    expect(body.customer).toBeUndefined();
  });

  it("labels anonymous and signed-in chats alike, so every thread is branded", async () => {
    const anonymous = await callJSON();
    mocks.readSessionCookie.mockReturnValue(session);
    mocks.fetchViewerIdentity.mockResolvedValue({
      user: { id: "u1", email: "verified@example.com" },
    });
    const identified = await callJSON();

    expect(anonymous.labelTypeIds).toEqual(["lt_brand"]);
    expect(identified.labelTypeIds).toEqual(["lt_brand"]);
  });

  it("supports several comma-separated label ids", async () => {
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS", " lt_a , lt_b ,, ");

    expect((await callJSON()).labelTypeIds).toEqual(["lt_a", "lt_b"]);
  });

  it("falls back to the Brand: Oppulence label when unset", async () => {
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_LABEL_TYPE_IDS", "");

    expect((await callJSON()).labelTypeIds).toEqual(["lt_01M20XH6PFZ1F5EY4V19WWP7DG"]);
  });

  it("identifies a signed-in user with a verified email and its hash", async () => {
    mocks.readSessionCookie.mockReturnValue(session);
    mocks.fetchViewerIdentity.mockResolvedValue({
      user: { id: "u1", email: "verified@example.com" },
    });

    const body = await callJSON();

    expect(body.customer).toEqual({
      email: "verified@example.com",
      emailHash: emailHash("verified@example.com"),
    });
  });

  it("falls back to the sealed session email when the API is unavailable", async () => {
    mocks.readSessionCookie.mockReturnValue(session);
    mocks.fetchViewerIdentity.mockRejectedValue(new Error("api down"));

    const body = await callJSON();

    expect(body.customer?.email).toBe("stale@example.com");
  });

  it("omits the identity when no chat secret can sign it", async () => {
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_SECRET", "");
    mocks.readSessionCookie.mockReturnValue(session);
    mocks.fetchViewerIdentity.mockResolvedValue({
      user: { id: "u1", email: "verified@example.com" },
    });

    const body = await callJSON();

    expect(body).toEqual({
      configured: true,
      appId: "chat-app-id",
      labelTypeIds: ["lt_brand"],
    });
  });

  it("never caches the response, since it carries a per-user credential", async () => {
    expect((await call()).headers.get("cache-control")).toBe("no-store");
  });
});

describe("support chat email hash", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_SECRET", "chat-secret");
  });

  it("matches Plain's documented HMAC-SHA256 construction", () => {
    // Golden value computed independently of this code, with Python:
    //   hmac.new(b"chat-secret", b"johndoe@example.com", hashlib.sha256).hexdigest()
    // If this drifts, Plain will reject every identity we send.
    expect(emailHash("johndoe@example.com")).toBe(
      "70633fd911d78f9c6ef898a87eb10f3fa5953fdd8bd13b5b27d15a43274effb9",
    );
    expect(emailHash("johndoe@example.com")).not.toBe(emailHash("jane@example.com"));
  });

  it("is case sensitive, matching the exact email passed to the widget", () => {
    expect(emailHash("User@example.com")).not.toBe(emailHash("user@example.com"));
  });

  it("returns null without a secret rather than an unverifiable hash", () => {
    vi.stubEnv("ROWBOAT_WWW_PLAIN_CHAT_SECRET", "");
    expect(emailHash("user@example.com")).toBeNull();
  });
});
