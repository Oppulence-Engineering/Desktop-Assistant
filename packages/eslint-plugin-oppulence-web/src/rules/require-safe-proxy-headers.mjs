import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

export default createRule({
  name: "require-safe-proxy-headers",
  meta: {
    type: "problem",
    docs: { description: "WEB010: BFF request headers must use an explicit allowlist" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      denylist:
        "WEB010 Do not iterate and forward all request headers. Copy only an explicit reviewed allowlist.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        const method = node.callee.property;
        if (method.type !== "Identifier" || !["forEach", "entries"].includes(method.name)) return;
        const objectText = context.sourceCode.getText(node.callee.object);
        if (/request\.headers|req\.headers/.test(objectText)) {
          context.report({ node, messageId: "denylist" });
        }
      },
    };
  },
});
