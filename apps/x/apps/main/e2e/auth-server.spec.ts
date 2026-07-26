import { expect, test } from "@playwright/test";

import { renderOAuthErrorPage, renderOAuthSuccessPage } from "../src/auth-server";

test("OAuth success callback uses the Oppulence onboarding shell", () => {
  const html = renderOAuthSuccessPage();

  expect(html).toContain("Oppulence");
  expect(html).toContain("Your AI coworker, with memory");
  expect(html).toContain("Private · on your machine");
  expect(html).toContain("We received the sign-in response");
  expect(html).toContain("Return to Oppulence");
  expect(html).not.toContain("Connected to Oppulence");
  expect(html).not.toContain("Authorization Successful");
});

test("OAuth error callback uses the Oppulence onboarding shell and escapes errors", () => {
  const html = renderOAuthErrorPage("<script>alert(1)</script>");

  expect(html).toContain("Oppulence");
  expect(html).toContain("Your AI coworker, with memory");
  expect(html).toContain("Sign-in could not be completed");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert(1)</script>");
});
