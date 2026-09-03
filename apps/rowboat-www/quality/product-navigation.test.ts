import { describe, expect, it } from "vitest";

import { PRODUCT_VIEW_PATHS, productViewForPathname } from "@/lib/product-navigation";

describe("product navigation", () => {
  it("round-trips every dashboard route", () => {
    for (const [view, path] of Object.entries(PRODUCT_VIEW_PATHS)) {
      expect(productViewForPathname(path)).toBe(view);
    }
  });
});
