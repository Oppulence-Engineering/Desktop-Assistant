import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Every Google scope the desktop requires must be one the server requests.
 *
 * `disconnectGoogleIfScopesStale` (apps/main/src/oauth-handler.ts) compares the
 * stored grant against `providers.ts` on every startup and, when anything is
 * missing, revokes the token at Google and clears it locally so the user is
 * prompted to reconnect. That is correct behaviour when a scope list genuinely
 * changes — and a trap when the desktop asks for something the server never
 * requests, because reconnecting cannot satisfy it:
 *
 *   connect → granted readonly/compose/send → restart → "missing gmail.modify"
 *   → revoked at Google → reconnect → granted the same set → restart → revoked…
 *
 * That loop ran in production. `providers.ts` listed `gmail.modify` while
 * `internal/google/handler.go` requested readonly/compose/send, so every Google
 * connection died on the next app launch, taking calendar sync with it. Nothing
 * failed loudly; the app just went quiet and asked the user to reconnect again.
 *
 * The two lists live in different languages in different processes, so this
 * reads the Go source directly. A string-matching test is unusual, but the
 * alternative is no check at all across a boundary that has now drifted twice.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../..");

function readSource(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

/** Scopes listed in the Go broker's defaultScopes. */
function serverScopes(): string[] {
  const go = readSource("apps/rowboat-api/internal/google/handler.go");
  const block = go.slice(
    go.indexOf("var defaultScopes = []string{"),
    go.indexOf("}", go.indexOf("var defaultScopes = []string{")),
  );
  return [...block.matchAll(/"(https:\/\/www\.googleapis\.com\/auth\/[^"]+)"/g)].map((m) => m[1]);
}

/** Scopes the desktop's provider config requires for google. */
function desktopScopes(): string[] {
  const ts = readSource("apps/x/packages/core/src/auth/providers.ts");
  const start = ts.indexOf("google: {");
  const block = ts.slice(start, ts.indexOf("},", ts.indexOf("scopes: [", start)));
  return [...block.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g)].map((m) => m[1]);
}

describe("Google scope contract between desktop and server", () => {
  it("finds both scope lists", () => {
    // Guard the guard: a rename that silently empties either list would make
    // every assertion below vacuously pass.
    expect(serverScopes().length).toBeGreaterThan(3);
    expect(desktopScopes().length).toBeGreaterThan(0);
  });

  it("never requires a scope the server does not request", () => {
    const granted = new Set(serverScopes());
    const unsatisfiable = desktopScopes().filter((s) => !granted.has(s));
    // Each of these revokes the user's Google connection on every app start,
    // and reconnecting cannot fix it.
    expect(unsatisfiable).toEqual([]);
  });

  it("keeps the scope the mailbox sync loop gates on", () => {
    // sync_gmail.ts REQUIRED_SCOPE — checked by name, not by implication.
    expect(serverScopes()).toContain("https://www.googleapis.com/auth/gmail.readonly");
  });
});
