import { describe, expect, it } from "vitest";

import { withQueryString } from "@/lib/api/query-string";

describe("withQueryString", () => {
  it("omits empty values so default list paths stay bare", () => {
    expect(withQueryString("/revenue-actions", undefined)).toBe("/revenue-actions");
    expect(withQueryString("/revenue-actions", { queueStatus: "", limit: undefined })).toBe(
      "/revenue-actions",
    );
  });

  it("serializes scalars and repeats array members", () => {
    expect(withQueryString("/revenue-actions", { queueStatus: "open", limit: 25 })).toBe(
      "/revenue-actions?queueStatus=open&limit=25",
    );
    expect(withQueryString("/search", { tag: ["a", "b"] })).toBe("/search?tag=a&tag=b");
  });
});
