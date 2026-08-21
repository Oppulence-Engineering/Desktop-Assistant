import { createRule, isMemberCall, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

export default createRule({
  name: "no-raw-browser-storage",
  meta: {
    type: "problem",
    docs: { description: "WEB007: browser storage must go through a scoped adapter" },
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
      raw: "WEB007 Raw browser storage is restricted to lib/storage. Use the scoped, versioned storage adapter.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (
      matchesAnyPath(filename, [
        "lib/storage/",
        ...(options.allowPaths ?? []),
        ...(options.allowFiles ?? []),
      ])
    )
      return {};
    return {
      CallExpression(node) {
        if (
          isMemberCall(node, "localStorage", ["getItem", "setItem", "removeItem", "clear"]) ||
          isMemberCall(node, "sessionStorage", ["getItem", "setItem", "removeItem", "clear"])
        ) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
});
