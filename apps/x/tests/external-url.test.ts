import assert from "node:assert/strict";
import test from "node:test";

import {
  MACOS_SYSTEM_SETTINGS_PROTOCOLS,
  validateExternalUrl,
} from "../apps/main/src/external-url-policy.ts";

test("external URL validation accepts browser-safe protocols", () => {
  assert.equal(validateExternalUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(validateExternalUrl("mailto:user@example.com"), "mailto:user@example.com");
});

test("external URL validation rejects executable and script protocols", () => {
  assert.throws(() => validateExternalUrl("javascript:alert(1)"), /not allowed/);
  assert.throws(() => validateExternalUrl("file:///tmp/payload"), /not allowed/);
  assert.throws(() => validateExternalUrl("not a URL"), /invalid/);
});

test("macOS settings protocol requires an explicit capability", () => {
  const target = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  assert.throws(() => validateExternalUrl(target), /not allowed/);
  assert.equal(validateExternalUrl(target, MACOS_SYSTEM_SETTINGS_PROTOCOLS), target);
});
