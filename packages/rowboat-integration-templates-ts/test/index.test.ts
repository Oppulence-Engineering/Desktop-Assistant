import { describe, expect, it } from "vitest";
import {
  getIntegrationTemplate,
  getTemplateBlocks,
  IntegrationTemplateCatalogSchema,
  INTEGRATION_TEMPLATES,
  listIntegrationTemplates,
} from "../src/index.js";

describe("integration template catalog", () => {
  it("exports the built-in connector templates", () => {
    expect(listIntegrationTemplates().map((template) => template.connector)).toEqual([
      "canvas",
      "corinthian",
      "wispr",
      "hubspot",
      "github",
      "linear",
      "notion",
      "stripe",
    ]);
    expect(getIntegrationTemplate("github")?.displayName).toBe("GitHub");
    expect(getTemplateBlocks("github").length).toBeGreaterThan(0);
  });

  it("rejects duplicate connector and block ids", () => {
    const duplicatedConnector = {
      ...INTEGRATION_TEMPLATES[0],
      blocks: [INTEGRATION_TEMPLATES[0].blocks[0], INTEGRATION_TEMPLATES[0].blocks[0]],
    };
    const result = IntegrationTemplateCatalogSchema.safeParse([
      duplicatedConnector,
      duplicatedConnector,
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("duplicate connector canvas");
      expect(messages).toContain("duplicate block id invoice-context");
    }
  });
});
