import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PutEntity200Response, PutEntityBody } from "../lib/api/generated/zod/entities/entities";

const fingerprint = `sha256:v1:${"a".repeat(64)}`;

describe("entity projection generated contract", () => {
  it("matches backend collection and identifier-key constraints", () => {
    const base = { displayName: "Acme", kind: "company" };
    expect(
      PutEntityBody.safeParse({
        ...base,
        identifiers: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`key${String(index)}`, [fingerprint]]),
        ),
      }).success,
    ).toBe(false);
    expect(
      PutEntityBody.safeParse({ ...base, identifiers: { "secret@example.com": [fingerprint] } })
        .success,
    ).toBe(false);
    expect(
      PutEntityBody.safeParse({
        ...base,
        identifiers: { emailDomains: [fingerprint, fingerprint] },
      }).success,
    ).toBe(false);
    expect(
      PutEntityBody.safeParse({
        ...base,
        resourceRefs: ["conduit:customer:cus_1", "conduit:customer:cus_1"],
      }).success,
    ).toBe(false);
  });

  it.runIf(Boolean(process.env.ENTITY_CONTRACT_RESPONSE_PATH))(
    "accepts the real authenticated entity response",
    () => {
      const responsePath = process.env.ENTITY_CONTRACT_RESPONSE_PATH;
      if (!responsePath) {
        throw new Error("ENTITY_CONTRACT_RESPONSE_PATH is required");
      }
      const response = JSON.parse(fs.readFileSync(responsePath, "utf8")) as unknown;
      const parsed = PutEntity200Response.parse(response);
      expect(parsed.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(parsed.status).toBe("active");
    },
  );
});
