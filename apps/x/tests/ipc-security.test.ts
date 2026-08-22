import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedRendererUrl } from "../apps/main/src/ipc-security.ts";

test("packaged IPC accepts only the app shell origin", () => {
  assert.equal(isTrustedRendererUrl("app://-/index.html", true), true);
  assert.equal(isTrustedRendererUrl("app://workspace/knowledge/note.md", true), false);
  assert.equal(isTrustedRendererUrl("https://example.com", true), false);
  assert.equal(isTrustedRendererUrl("file:///tmp/index.html", true), false);
});

test("development IPC accepts only the fixed local renderer origins", () => {
  assert.equal(isTrustedRendererUrl("http://localhost:5173/settings", false), true);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/", false), true);
  assert.equal(isTrustedRendererUrl("http://localhost:4173/", false), false);
  assert.equal(isTrustedRendererUrl("https://localhost:5173/", false), false);
});
