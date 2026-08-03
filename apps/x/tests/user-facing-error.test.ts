import assert from "node:assert/strict";
import test from "node:test";

import { userFacingError } from "../apps/renderer/src/lib/user-facing-error.ts";

test("turns rejected auth IPC calls into an actionable session message", () => {
  const error = new Error(
    "Error invoking remote method 'relationships:sources': AuthUnavailableError: WorkOS reports invalid_grant; sign in again.",
  );

  assert.equal(
    userFacingError(error, "Could not load relationship intelligence."),
    "Your Oppulence session expired. Sign in again to continue.",
  );
});

test("does not expose internal IPC channel or exception details", () => {
  const error = new Error(
    "Error invoking remote method 'relationships:list': Error: SQLITE_BUSY: database is locked",
  );

  assert.equal(
    userFacingError(error, "Could not load relationship intelligence."),
    "Could not load relationship intelligence.",
  );
});

test("preserves an already user-facing error", () => {
  assert.equal(
    userFacingError(new Error("Choose at least one relationship."), "Something went wrong."),
    "Choose at least one relationship.",
  );
});

test("uses the fallback for non-error values", () => {
  assert.equal(
    userFacingError({ code: "UNKNOWN" }, "Something went wrong."),
    "Something went wrong.",
  );
});
