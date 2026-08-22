import { createRule, matchesAnyPath, normalizedFilename, propertyName } from "../rule-utils.mjs";

export default createRule({
  name: "no-raw-upstream-errors",
  meta: {
    type: "problem",
    docs: { description: "WEB012: redirects must expose stable public error codes only" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      raw: "WEB012 Do not place a variable/upstream error in a redirect query. Use a stable public error code.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || propertyName(node.callee.property) !== "set")
          return;
        const [key, value] = node.arguments;
        if (key?.type !== "Literal" || key.value !== "error" || !value) return;
        if (value.type !== "Literal") context.report({ node, messageId: "raw" });
      },
    };
  },
});
