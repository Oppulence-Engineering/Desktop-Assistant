import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

function containsAwait(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "AwaitExpression") return true;
  return Object.entries(node).some(([key, value]) => {
    if (["parent", "loc", "range", "tokens", "comments"].includes(key)) return false;
    if (Array.isArray(value)) return value.some(containsAwait);
    return containsAwait(value);
  });
}

export default createRule({
  name: "no-async-setinterval",
  meta: {
    type: "problem",
    docs: { description: "WEB006: async setInterval polling can overlap" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      overlap:
        "WEB006 Async setInterval polling can overlap. Use TanStack Query, AbortSignal-aware polling, or a self-scheduling timeout.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        const isInterval =
          (callee.type === "Identifier" && callee.name === "setInterval") ||
          (callee.type === "MemberExpression" &&
            callee.property.type === "Identifier" &&
            callee.property.name === "setInterval");
        if (!isInterval) return;
        const callback = node.arguments[0];
        if (
          callback &&
          callback.type !== "SpreadElement" &&
          (callback.async || containsAwait(callback.body))
        ) {
          context.report({ node, messageId: "overlap" });
        }
      },
    };
  },
});
