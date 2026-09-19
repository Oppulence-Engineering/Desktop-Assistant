import { describe, expect, it } from "vitest";

import { reportSearchParamsCache } from "@/app/(product)/app/report/search-params";
import { revenueSearchParamsCache } from "@/app/(product)/app/revenue/search-params";
import { settingsSearchParamsCache } from "@/app/(product)/app/settings/search-params";
import { workflowSearchParamsCache } from "@/app/(product)/app/workflows/search-params";

describe("product search-params caches", () => {
  it("parses defaults and validated values from the same parsers the client uses", () => {
    expect(reportSearchParamsCache.parse({}).scan).toBeNull();
    expect(reportSearchParamsCache.parse({ scan: "scan-1" }).scan).toBe("scan-1");
    expect(revenueSearchParamsCache.parse({}).tab).toBe("commitments");
    expect(revenueSearchParamsCache.parse({ tab: "queue" }).tab).toBe("queue");
    expect(settingsSearchParamsCache.parse({}).settings).toBe("overview");
    expect(settingsSearchParamsCache.parse({ settings: "connections" }).settings).toBe(
      "connections",
    );
    expect(workflowSearchParamsCache.parse({}).focus).toBe("scheduled");
    expect(workflowSearchParamsCache.parse({ focus: "runs" }).focus).toBe("runs");
  });
});
