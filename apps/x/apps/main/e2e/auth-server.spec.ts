import { expect, test } from "@playwright/test";

import { renderOAuthErrorPage, renderOAuthSuccessPage } from "../src/auth-server";

test("OAuth success callback reuses the Oppulence login experience", () => {
  const html = renderOAuthSuccessPage();

  expect(html).toContain("Oppulence");
  expect(html).toContain('class="auth-shell"');
  expect(html).toContain('data-auth-state="authenticating"');
  expect(html).toContain("Authenticating…");
  expect(html).toContain("Finishing secure sign-in");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("This window will close automatically");
  expect(html).toContain("Local data preserved");
  expect(html).not.toContain("Your AI coworker, with memory");
  expect(html).not.toContain("Connected to Oppulence");
  expect(html).not.toContain("Authorization Successful");
});

test("OAuth error callback reuses the login experience and escapes errors", () => {
  const html = renderOAuthErrorPage("<script>alert(1)</script>");

  expect(html).toContain("Oppulence");
  expect(html).toContain('class="auth-shell"');
  expect(html).toContain('data-auth-state="error"');
  expect(html).toContain("Sign-in could not be completed");
  expect(html).toContain('aria-busy="false"');
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("Your AI coworker, with memory");
});
