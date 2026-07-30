import { describe, expect, it } from "vitest";
import * as path from "node:path";

/**
 * The guard every session-scoped channel uses, exercised directly.
 *
 * `meeting:sessionTranscript`, `audioTracks`, `commitments`, `confirmCommitment`,
 * `dismissCommitment` and `deleteSession` all take a session id straight from the
 * renderer and join it onto the recordings root. The check is one line in each, which is
 * exactly the kind of thing that gets copied slightly wrong — so the rule itself is
 * pinned here rather than trusted six times.
 */
function insideRoot(root: string, sessionId: string): boolean {
  const dir = path.join(root, sessionId);
  return path.dirname(path.resolve(dir)) === path.resolve(root);
}

/**
 * The `app://recording/<sessionId>/<file>` handler's own guard.
 *
 * Pinned separately because it is the one path in this feature that can reach *outside*
 * the workspace — the recordings root is user-configurable — and because its first line
 * of defence is a character class that happens to permit dots, so `..` gets through it
 * and is stopped only by the resolve check underneath.
 */
function servesRecording(root: string, pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return false;
  const [sessionId, file] = parts;
  if (!/^[\w.@-]+$/.test(sessionId) || !/^[\w.@-]+$/.test(file)) return false;
  const absPath = path.resolve(root, sessionId, file);
  return path.dirname(path.dirname(absPath)) === path.resolve(root);
}

describe("app://recording guard", () => {
  const root = "/Users/x/Recordings";

  it("serves a real track", () => {
    expect(servesRecording(root, "/2026.07.30-1015/mic.wav")).toBe(true);
    expect(servesRecording(root, "/2026.07.30-1015/system.m4a")).toBe(true);
  });

  it("stops `..` even though the character class allows dots", () => {
    expect(servesRecording(root, "/../mic.wav")).toBe(false);
    expect(servesRecording(root, "/../../mic.wav")).toBe(false);
    expect(servesRecording(root, "/2026.07.30-1015/..")).toBe(false);
    expect(servesRecording(root, "/../..")).toBe(false);
  });

  it("rejects a separator smuggled through, and the wrong number of segments", () => {
    expect(servesRecording(root, "/a%2Fb/mic.wav")).toBe(false);
    expect(servesRecording(root, "/mic.wav")).toBe(false);
    expect(servesRecording(root, "/a/b/c")).toBe(false);
    expect(servesRecording(root, "/")).toBe(false);
  });
});

describe("session-id traversal guard", () => {
  const root = "/Users/x/.rowboat/recordings";

  it("accepts a real session id", () => {
    expect(insideRoot(root, "2026.07.30-1015")).toBe(true);
  });

  it("rejects anything that climbs out", () => {
    for (const attempt of [
      "..",
      "../..",
      "../other",
      "../../.ssh",
      "a/../../b",
      "./../../etc",
      "/etc/passwd",
      "/",
    ]) {
      expect({ attempt, allowed: insideRoot(root, attempt) }).toEqual({ attempt, allowed: false });
    }
  });

  it("rejects a nested path even when it stays inside", () => {
    // Sessions are flat. A nested path is not a session, and allowing one would let a
    // caller reach files the session listing never offered.
    expect(insideRoot(root, "2026.07.30-1015/tracks")).toBe(false);
  });

  it("rejects an empty id, which resolves to the root itself", () => {
    // `deleteSession("")` would otherwise target the recordings root.
    expect(insideRoot(root, "")).toBe(false);
  });
});
