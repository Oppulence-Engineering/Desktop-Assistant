import assert from "node:assert/strict";
import test from "node:test";

import { runAccountDeletion } from "../apps/main/src/account-deletion.ts";
import { accountDeletionErrorMessage } from "../apps/renderer/src/lib/account-deletion.ts";

// Plain JavaScript syntax: the desktop ESLint config lints tests/ without the
// TypeScript parser.

class ProblemError extends Error {
  constructor(code) {
    super(`problem ${code}`);
    this.code = code;
  }
}

function recordingSteps(overrides = {}) {
  const calls = [];
  const steps = {
    deleteAccount: async () => {
      calls.push("deleteAccount");
    },
    clearSession: async () => {
      calls.push("clearSession");
    },
    problemCode: (error) => (error instanceof ProblemError ? error.code : null),
    ...overrides,
  };
  return { calls, steps };
}

test("a successful deletion calls the API once and then clears the local session", async () => {
  const { calls, steps } = recordingSteps();
  assert.deepEqual(await runAccountDeletion(steps), { success: true, code: null });
  assert.deepEqual(calls, ["deleteAccount", "clearSession"]);
});

for (const code of [
  "workspace_successor_required",
  "billing_cancellation_failed",
  "confirmation_required",
]) {
  test(`a refusal with ${code} keeps the session and returns the code`, async () => {
    const { calls, steps } = recordingSteps({
      deleteAccount: async () => {
        calls.push("deleteAccount");
        throw new ProblemError(code);
      },
    });
    assert.deepEqual(await runAccountDeletion(steps), { success: false, code });
    assert.deepEqual(calls, ["deleteAccount"], "the session must survive a refused deletion");
  });
}

test("a failure without a problem code returns a null code", async () => {
  const { calls, steps } = recordingSteps({
    deleteAccount: async () => {
      calls.push("deleteAccount");
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(await runAccountDeletion(steps), { success: false, code: null });
  assert.deepEqual(calls, ["deleteAccount"]);
});

test("a local sign-out failure still reports the completed deletion", async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args);
  };
  try {
    const { calls, steps } = recordingSteps({
      clearSession: async () => {
        calls.push("clearSession");
        throw new Error("keychain locked");
      },
    });
    assert.deepEqual(await runAccountDeletion(steps), { success: true, code: null });
    assert.deepEqual(calls, ["deleteAccount", "clearSession"]);
    assert.equal(warnings.length, 1, "the sign-out failure is logged once");
  } finally {
    console.warn = warn;
  }
});

test("the problem code reader only sees API failures", async () => {
  const seen = [];
  const failure = new ProblemError("workspace_successor_required");
  const { steps } = recordingSteps({
    deleteAccount: async () => {
      throw failure;
    },
    problemCode: (error) => {
      seen.push(error);
      return null;
    },
  });
  await runAccountDeletion(steps);
  assert.deepEqual(seen, [failure]);

  const afterSuccess = [];
  await runAccountDeletion(
    recordingSteps({
      problemCode: (error) => {
        afterSuccess.push(error);
        return null;
      },
    }).steps,
  );
  assert.deepEqual(afterSuccess, [], "a successful deletion reads no problem code");
});

test("a refused deletion tells the user what to do next", () => {
  assert.match(
    accountDeletionErrorMessage("workspace_successor_required"),
    /Remove the other members/,
  );
  assert.match(accountDeletionErrorMessage("billing_cancellation_failed"), /not deleted/);
});

test("every known refusal has its own message", () => {
  const messages = new Set([
    accountDeletionErrorMessage("workspace_successor_required"),
    accountDeletionErrorMessage("billing_cancellation_failed"),
    accountDeletionErrorMessage(null),
  ]);
  assert.equal(messages.size, 3);
});

test("an unknown failure never claims the account was deleted", () => {
  for (const code of [
    null,
    undefined,
    "",
    "internal_error",
    "rate_limited",
    "connector_revocation_failed",
    "confirmation_required",
  ]) {
    assert.match(accountDeletionErrorMessage(code), /could not delete/);
  }
});

test("messages never show a raw problem code", () => {
  for (const code of [
    "workspace_successor_required",
    "billing_cancellation_failed",
    "internal_error",
  ]) {
    assert.ok(
      !accountDeletionErrorMessage(code).includes(code),
      `message for ${code} leaks the code`,
    );
  }
});
