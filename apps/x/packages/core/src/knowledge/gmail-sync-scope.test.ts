import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The Gmail sync loop must gate on a scope the managed connect flow actually
 * grants.
 *
 * It gated on `gmail.modify` — a write scope the server never requests — so a
 * mailbox connected through that flow logged "missing required Gmail scope"
 * every 30 seconds and never synced a single message, while calendar synced
 * normally beside it because *its* required scope was granted.
 *
 * Asserted against the source rather than by running the loop: the loop needs
 * Electron, a Google client and a live token, none of which exist here, and the
 * defect was a single constant. Pinning the constant catches the regression
 * that actually happened.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "sync_gmail.ts"), "utf8");

function constantValue(name: string): string | null {
  const m = source.match(new RegExp(`const ${name} = "([^"]+)"`));
  return m ? m[1] : null;
}

/** What apps/rowboat-api/internal/google/handler.go requests for Gmail. */
const MANAGED_GRANT = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
];

describe("Gmail sync scope gate", () => {
  it("requires a scope the managed connect flow grants", () => {
    const required = constantValue("REQUIRED_SCOPE");
    expect(required).not.toBeNull();
    expect(MANAGED_GRANT).toContain(required);
  });

  it("does not gate the read loop on a write scope", () => {
    // The exact regression: REQUIRED_SCOPE = ".../gmail.modify".
    expect(constantValue("REQUIRED_SCOPE")).not.toBe(
      "https://www.googleapis.com/auth/gmail.modify",
    );
  });

  it("still knows which scope the mutating thread actions need", () => {
    // Relaxing the loop must not lose the write requirement — it moves to the
    // point of use so a missing grant costs those actions, not the whole sync.
    expect(constantValue("WRITE_SCOPE")).toBe("https://www.googleapis.com/auth/gmail.modify");
  });

  it("checks the write scope in every mutating thread action", () => {
    for (const fn of ["archiveThread", "trashThread", "markThreadRead"]) {
      const body = source.slice(source.indexOf(`export async function ${fn}(`));
      const guard = body.indexOf("writeScopeError()");
      const call = body.indexOf("getGmailClientOrThrow()");
      expect(guard, `${fn} checks the write scope`).toBeGreaterThan(-1);
      // Before the network call, so a denial is explained rather than surfacing
      // as Google's bare "insufficient authentication scopes" 403.
      expect(guard, `${fn} checks before calling Gmail`).toBeLessThan(call);
    }
  });
});
