import { createRule, matchesAnyPath, normalizedFilename, propertyName } from "../rule-utils.mjs";

export default createRule({
  name: "require-abort-signal",
  meta: {
    type: "problem",
    docs: { description: "WEB011: raw API fetches require a cancellation or timeout signal" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      signal: "WEB011 API fetch() requires an AbortSignal for cancellation or a bounded timeout.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "fetch") return;
        const init = node.arguments[1];
        if (!init || init.type === "SpreadElement") {
          context.report({ node, messageId: "signal" });
          return;
        }
        if (init.type !== "ObjectExpression") return;
        const hasSignal = init.properties.some(
          (property) => property.type === "Property" && propertyName(property.key) === "signal",
        );
        if (!hasSignal) context.report({ node, messageId: "signal" });
      },
    };
  },
});
