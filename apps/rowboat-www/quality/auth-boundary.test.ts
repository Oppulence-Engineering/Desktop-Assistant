import { describe, expect, it } from "vitest";

import { safeReturnTo } from "@/lib/auth/pkce";
import { dashboardProxyHeaders, dashboardProxyPath } from "@/lib/auth/proxy";

describe("authentication and BFF boundaries", () => {
  it.each(["https://evil.example/path", "//evil.example/path", "javascript:alert(1)"])(
    "rejects unsafe return target %s",
    (target) => {
      expect(safeReturnTo(target)).toBe("/app");
    },
  );

  it("preserves safe relative paths including query and fragment", () => {
    expect(safeReturnTo("/app/agents?view=active#agent-1")).toBe("/app/agents?view=active#agent-1");
  });

  it("forces dashboard proxy paths beneath /v1", () => {
    expect(dashboardProxyPath(["agents", "a/b"])).toBe("/v1/agents/a%2Fb");
    expect(dashboardProxyPath(["v1", "me"])).toBe("/v1/me");
    expect(dashboardProxyPath([])).toBe("/v1/me");
  });

  it("forwards approval credentials but drops arbitrary browser headers", () => {
    const forwarded = dashboardProxyHeaders(
      new Headers({ "X-Approval-Token": "signed", "X-Continuation-Token": "resume", Cookie: "no" }),
    );
    expect(forwarded.get("x-approval-token")).toBe("signed");
    expect(forwarded.get("x-continuation-token")).toBe("resume");
    expect(forwarded.has("cookie")).toBe(false);
  });
});
