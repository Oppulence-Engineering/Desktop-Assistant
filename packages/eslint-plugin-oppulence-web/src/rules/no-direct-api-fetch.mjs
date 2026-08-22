import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

const DEFAULT_ALLOWED = ["app/api/", "lib/api/", "lib/bff/", "generated/api/"];

export default createRule({
  name: "no-direct-api-fetch",
  meta: {
    type: "problem",
    docs: { description: "WEB005: fetch is restricted to the API/BFF layer" },
    schema: [
      {
        type: "object",
        properties: {
          allowFiles: { type: "array", items: { type: "string" } },
          allowPaths: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      direct:
        "WEB005 Direct fetch() is restricted to lib/api, lib/bff, generated clients, and route handlers. Consume a domain client or query hook instead.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    const allowed = [
      ...DEFAULT_ALLOWED,
      ...(options.allowPaths ?? []),
      ...(options.allowFiles ?? []),
    ];
    if (matchesAnyPath(filename, allowed)) return {};
    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
          context.report({ node, messageId: "direct" });
        }
      },
    };
  },
});
