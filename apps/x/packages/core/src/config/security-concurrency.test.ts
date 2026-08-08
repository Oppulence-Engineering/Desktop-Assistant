import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_WORKDIR = vi.hoisted(() => "/tmp/rowboat-security-concurrency-test");
vi.mock("./config.js", () => ({ WorkDir: TEST_WORKDIR }));

import { addFileAccessGrant, addToSecurityConfig } from "./security.js";

/**
 * Both mutators rewrite the whole file from a value they read first, so
 * concurrent grants lost each other.
 *
 * This is the everyday path, not a corner case: one assistant turn raises a
 * permission prompt per candidate tool, the renderer fires each approval as its
 * own runs:authorizePermission, and that handler awaits a full run-log fetch
 * before reaching the write — which guarantees the second invocation is
 * scheduled inside the first's window. The user saw "Always allow" succeed and
 * was re-prompted for the grant that got dropped.
 *
 * These tests also stand in for a reentrancy check: withFileLock is a
 * non-reentrant promise queue, so if a locked mutator ever called another one,
 * these would hang rather than fail.
 */

const CONFIG = path.join(TEST_WORKDIR, "config", "security.json");

/** Read what actually landed on disk — a stronger check than any cached getter. */
function onDisk(): { allowedCommands: string[]; allowedFileAccess: { pathPrefix: string }[] } {
  return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
}

beforeEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_WORKDIR, "config"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_WORKDIR, { recursive: true, force: true });
});

describe("concurrent permission grants", () => {
  it("keeps a command grant and a file grant issued in the same tick", async () => {
    await Promise.all([
      addToSecurityConfig(["curl"]),
      addFileAccessGrant({ operation: "read", pathPrefix: "/Users/x/Docs" } as never),
    ]);

    const config = onDisk();
    expect(config.allowedCommands).toContain("curl");
    expect(config.allowedFileAccess.map((g) => g.pathPrefix)).toContain("/Users/x/Docs");
  });

  it("keeps every command from a burst of approvals", async () => {
    const commands = ["curl", "wget", "rsync", "ssh", "docker", "kubectl"];
    await Promise.all(commands.map((c) => addToSecurityConfig([c])));

    const allowed = onDisk().allowedCommands;
    for (const c of commands) {
      expect(allowed, `${c} was lost to a concurrent grant`).toContain(c);
    }
  });

  it("keeps every file grant from a burst of approvals", async () => {
    const prefixes = ["/a", "/b", "/c", "/d", "/e"];
    await Promise.all(
      prefixes.map((p) => addFileAccessGrant({ operation: "read", pathPrefix: p } as never)),
    );

    const granted = onDisk().allowedFileAccess.map((g) => g.pathPrefix);
    for (const p of prefixes) {
      expect(granted, `${p} was lost to a concurrent grant`).toContain(p);
    }
  });

  it("leaves the file parseable and free of temp siblings", async () => {
    await Promise.all([
      addToSecurityConfig(["curl"]),
      addToSecurityConfig(["wget"]),
      addFileAccessGrant({ operation: "write", pathPrefix: "/tmp/x" } as never),
    ]);

    expect(() => JSON.parse(fs.readFileSync(CONFIG, "utf8"))).not.toThrow();
    expect(fs.readdirSync(path.join(TEST_WORKDIR, "config"))).toEqual(["security.json"]);
  });
});
