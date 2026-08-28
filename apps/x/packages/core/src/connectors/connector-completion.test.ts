import { describe, expect, it } from "vitest";
import { parseConnectorCompletion } from "./connector-completion.js";

describe("desktop connector completion", () => {
  it("accepts only the exact code-only redemption route", () => {
    expect(
      parseConnectorCompletion(
        "solomon-ai://connection-complete?connector=google&status=success&session=one-time-code",
      ),
    ).toEqual({ connector: "google", status: "success", state: "one-time-code" });
    expect(
      parseConnectorCompletion(
        "solomon-ai://settings/connectors?connector=google&status=success&session=secret",
      ),
    ).toBeNull();
    expect(
      parseConnectorCompletion("https://oppulence.io/connection-complete?session=secret"),
    ).toBeNull();
    expect(
      parseConnectorCompletion("solomon-ai://connection-complete?connector=google"),
    ).toBeNull();
  });
});
