import { describe, expect, it } from "vitest";

import {
  DESKTOP_SIGN_IN,
  buildDesktopState,
  desktopCallbackTarget,
} from "@/lib/auth/desktop-callback";

const NONCE = "z".repeat(43);

describe("desktop sign-in hand-off", () => {
  it("bounces a desktop code to the app's loopback listener", () => {
    const state = buildDesktopState(5198, NONCE);

    const target = desktopCallbackTarget(state, "auth-code-123");

    // The desktop app listens on exactly this origin and path; WorkOS refuses
    // to redirect there itself, which is the whole reason this bounce exists.
    expect(target?.origin).toBe("http://127.0.0.1:5198");
    expect(target?.pathname).toBe(DESKTOP_SIGN_IN.callbackPath);
    expect(target?.searchParams.get("code")).toBe("auth-code-123");
    // State must survive the bounce: the app matches its nonce to reject codes
    // it never asked for.
    expect(target?.searchParams.get("state")).toBe(state);
  });

  it("leaves ordinary web sign-ins alone", () => {
    // A web state must fall through to the cookie-backed exchange rather than
    // being redirected anywhere.
    expect(desktopCallbackTarget(NONCE, "auth-code-123")).toBeNull();
    expect(desktopCallbackTarget(null, "auth-code-123")).toBeNull();
  });

  it("refuses to hand codes to a port the desktop app does not own", () => {
    // Otherwise any local process could name its own port and harvest
    // authorization codes through our registered redirect URI.
    expect(desktopCallbackTarget(buildDesktopState(9999, NONCE), "c")).toBeNull();
    expect(desktopCallbackTarget(buildDesktopState(80, NONCE), "c")).toBeNull();
  });

  it("rejects malformed desktop state instead of trusting it", () => {
    const malformed = [
      "desktop.5198.short", // nonce too small to be unguessable
      "desktop.5198.has spaces",
      "desktop..".concat(NONCE), // missing port
      "desktop.5198", // no nonce at all
      `desktop.5198.${NONCE}/../evil`,
      "desktop.51980000.".concat(NONCE), // port out of range
    ];

    for (const state of malformed) {
      expect(desktopCallbackTarget(state, "code")).toBeNull();
    }
  });

  it("cannot be steered off loopback by a crafted state", () => {
    // The host is hard-coded rather than taken from the state, so injection
    // attempts can only ever fail the port allowlist or the format check.
    const attempts = [
      "desktop.5198@evil.com.".concat(NONCE),
      "desktop.evil.com.".concat(NONCE),
      "desktop.5198.".concat(NONCE).concat("@evil.com"),
    ];

    for (const state of attempts) {
      const target = desktopCallbackTarget(state, "code");
      expect(target === null || target.hostname === "127.0.0.1").toBe(true);
    }
  });
});
