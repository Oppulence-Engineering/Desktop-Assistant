import assert from "node:assert/strict";
import test from "node:test";

import {
  dominantServiceFault,
  explainServiceError,
} from "../apps/renderer/src/lib/service-error-copy.ts";

/**
 * Data health used to print the gateway's raw code. Dogfooding on 2026-08-07:
 * every email-labeling batch failed with a red `insufficient_credits` for
 * hours, with an Upgrade button a few inches away in the same sidebar that
 * nothing connected it to.
 */
test("names the one thing the user can actually fix", () => {
  const copy = explainServiceError("insufficient_credits");

  assert.equal(copy.fault, "billing");
  assert.match(copy.text, /credits/i);
  assert.doesNotMatch(copy.text, /insufficient_credits/);
});

test("does not blame the user for our own provider account", () => {
  const ours = explainServiceError("upstream_credits_exhausted");
  const theirs = explainServiceError("insufficient_credits");

  assert.equal(ours.fault, "provider");
  assert.notEqual(ours.text, theirs.text);
  // "Upgrade" must not be offered for a bill only we can pay.
  assert.doesNotMatch(ours.text, /upgrade/i);
});

test("separates an expired session from a billing problem", () => {
  assert.equal(explainServiceError("embeddings proxy 401: invalid or expired token").fault, "auth");
  assert.equal(explainServiceError("Unauthorized (AI_APICallError)").fault, "auth");
});

test("explains a model the account cannot use", () => {
  const copy = explainServiceError(
    'embeddings proxy 400: {"code":"model_not_allowed","detail":"model is not allowed"}',
  );

  assert.equal(copy.fault, "config");
  assert.doesNotMatch(copy.text, /model_not_allowed/);
});

test("treats a transient provider failure as something that retries itself", () => {
  const copy = explainServiceError("upstream_error: Bad Gateway");

  assert.equal(copy.fault, "provider");
  assert.match(copy.text, /retries/i);
});

test("humanizes an unrecognised bare code rather than printing it raw", () => {
  assert.equal(explainServiceError("some_new_code").text, "Some new code.");
});

test("lets an unrecognised human message through unchanged", () => {
  const copy = explainServiceError("Could not read the calendar feed.");

  assert.equal(copy.text, "Could not read the calendar feed.");
  assert.equal(copy.fault, "unknown");
});

test("uses the first non-empty line of a multi-line error", () => {
  assert.equal(explainServiceError("\n\nUnauthorized\n  at foo()\n  at bar()").fault, "auth");
});

test("never returns an empty sentence", () => {
  assert.notEqual(explainServiceError("   ").text, "");
});

/**
 * When credits run out every service fails at once. Whichever error happened to
 * sort first would otherwise decide the headline, hiding the only cause the
 * user can clear.
 */
test("surfaces billing ahead of the noise it causes", () => {
  const fault = dominantServiceFault([
    "Unauthorized (AI_APICallError)",
    "insufficient_credits",
    "upstream_error: Bad Gateway",
  ]);

  assert.equal(fault?.fault, "billing");
});

test("has no dominant fault when nothing is failing", () => {
  assert.equal(dominantServiceFault([]), null);
});

/**
 * Services log what they caught, and that is regularly a pretty-printed JSON
 * body or a Zod issue array. Taking the first line of those produced a row that
 * said "[" — verified against the real services.jsonl from 2026-08-07.
 */
test("digs the sentence out of a pretty-printed JSON error", () => {
  const zodDump = `[
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [
      "provider"
    ],
    "message": "Invalid input: expected object, received undefined"
  }
]`;

  assert.equal(
    explainServiceError(zodDump).text,
    "Invalid input: expected object, received undefined",
  );
});

test("recognises a code buried inside a JSON body, not just on line one", () => {
  const problem = `embeddings proxy 400: {"type":"https://api.rowboat.dev/problems/model_not_allowed","title":"Bad Request","status":400,"detail":"model is not allowed","code":"model_not_allowed"}`;

  assert.equal(explainServiceError(problem).fault, "config");
});

test("never renders bare structural punctuation as a sentence", () => {
  assert.notEqual(explainServiceError("[\n  {\n").text.trim(), "[");
});
