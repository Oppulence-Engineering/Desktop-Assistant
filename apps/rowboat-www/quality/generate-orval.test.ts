import { describe, expect, it } from "vitest";

import { catalogFromOpenAPI, isReadMethod, toBffPath } from "@/scripts/generate/orval-operation";
import { parseGenerateArguments } from "@/scripts/generate";

describe("Orval operation catalog", () => {
  const catalog = catalogFromOpenAPI(
    {
      paths: {
        "/v1/widgets/{widgetId}": {
          get: {
            operationId: "getWidget",
            tags: ["Widgets"],
            responses: { "200": {} },
          },
        },
        "/v1/widgets": {
          get: {
            operationId: "listWidgets",
            tags: ["Widgets"],
            parameters: [
              { name: "limit", in: "query", schema: { type: "integer" } },
              { name: "status", in: "query", schema: { type: "string" } },
            ],
            responses: { "200": {} },
          },
          post: {
            operationId: "createWidget",
            tags: ["Widgets"],
            requestBody: {},
            responses: { "201": {} },
          },
        },
      },
    },
    new Map([
      ["GetWidget200Response", "@/lib/api/generated/zod/widgets/widgets"],
      ["ListWidgets200Response", "@/lib/api/generated/zod/widgets/widgets"],
      ["ListWidgetsQueryParams", "@/lib/api/generated/zod/widgets/widgets"],
      ["CreateWidget201Response", "@/lib/api/generated/zod/widgets/widgets"],
      ["CreateWidgetBody", "@/lib/api/generated/zod/widgets/widgets"],
    ]),
  );

  it("maps OpenAPI paths onto BFF paths and Orval schemas", () => {
    expect(toBffPath("/v1/widgets/{widgetId}")).toBe("/widgets/:widgetId");
    expect(isReadMethod("GET")).toBe(true);
    expect(isReadMethod("POST")).toBe(false);

    const read = catalog.get("getWidget");
    expect(read).toMatchObject({
      name: "get-widget",
      method: "GET",
      fetchPath: "/widgets/:widgetId",
      orvalSchema: "GetWidget200Response",
      orvalImport: "@/lib/api/generated/zod/widgets/widgets",
    });

    const list = catalog.get("listWidgets");
    expect(list).toMatchObject({
      orvalQuery: "ListWidgetsQueryParams",
      queryParams: [
        { name: "limit", type: "number" },
        { name: "status", type: "string" },
      ],
    });

    const write = catalog.get("CreateWidget");
    expect(write).toMatchObject({
      name: "create-widget",
      method: "POST",
      orvalSchema: "CreateWidget201Response",
      orvalBody: "CreateWidgetBody",
    });
  });

  it("accepts --operation without a kebab name", () => {
    const request = parseGenerateArguments(["hook", "--operation", "listConnectors"]);
    expect(request).toMatchObject({ kind: "hook", operation: "listConnectors" });
  });
});
