import { createRule, matchesAnyPath, normalizedFilename, propertyName } from "../rule-utils.mjs";

const SENSITIVE =
  /(?:access.?token|refresh.?token|authorization|prompt|payload|relationship|evidence|conversation|transcript|session|message|event|headers?|request\.body)/i;

export default createRule({
  name: "no-sensitive-console",
  meta: {
    type: "problem",
    docs: { description: "WEB013: sensitive product data must not be written to console" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      sensitive:
        "WEB013 Console output appears to contain sensitive product/auth data. Use sanitized, environment-gated telemetry.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (node.callee.object.type !== "Identifier" || node.callee.object.name !== "console")
          return;
        if (!propertyName(node.callee.property)) return;
        const args = node.arguments
          .map((argument) => context.sourceCode.getText(argument))
          .join(" ");
        if (SENSITIVE.test(args)) context.report({ node, messageId: "sensitive" });
      },
    };
  },
});
