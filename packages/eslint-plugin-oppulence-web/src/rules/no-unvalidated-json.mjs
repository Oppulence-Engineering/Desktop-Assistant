import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

function unwrapAwait(node) {
  return node?.type === "AwaitExpression" ? node.argument : node;
}

function isJSONCall(node) {
  const value = unwrapAwait(node);
  return (
    value?.type === "CallExpression" &&
    value.callee.type === "MemberExpression" &&
    value.callee.property.type === "Identifier" &&
    value.callee.property.name === "json"
  );
}

export default createRule({
  name: "no-unvalidated-json",
  meta: {
    type: "problem",
    docs: { description: "WEB004: response JSON must be treated as unknown and runtime-validated" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      cast: "WEB004 Do not cast response.json() to an application type. Parse unknown data with a runtime schema.",
      annotation:
        "WEB004 A typed variable cannot receive response.json() directly. Parse unknown data with a runtime schema.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      TSAsExpression(node) {
        if (isJSONCall(node.expression)) context.report({ node, messageId: "cast" });
      },
      TSTypeAssertion(node) {
        if (isJSONCall(node.expression)) context.report({ node, messageId: "cast" });
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.id.typeAnnotation && isJSONCall(node.init)) {
          context.report({ node, messageId: "annotation" });
        }
      },
    };
  },
});
