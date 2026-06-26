import { expect, test } from "@playwright/test";

import { renderOAuthErrorPage, renderOAuthSuccessPage } from "../src/auth-server";

test("OAuth success callback uses the Solomon onboarding shell", () => {
  const html = renderOAuthSuccessPage();

  expect(html).toContain("Solomon AI");
  expect(html).toContain("Your AI coworker, with memory");
  expect(html).toContain("Private · on your machine");
  expect(html).toContain("Connected to Solomon AI");
  expect(html).toContain("Return to Solomon AI");
  expect(html).not.toContain("Authorization Successful");
});

test("OAuth error callback uses the Solomon onboarding shell and escapes errors", () => {
  const html = renderOAuthErrorPage("<script>alert(1)</script>");

  expect(html).toContain("Solomon AI");
  expect(html).toContain("Your AI coworker, with memory");
  expect(html).toContain("Sign-in could not be completed");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert(1)</script>");
});
