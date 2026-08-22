import { createRule, isMemberCall, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

const SENSITIVE =
  /(?:AccessToken|RefreshToken|AuthSession|DashboardSession|StoredSession|ChatMessage|Conversation(?:Item)?|Transcript|Secret)/i;

function typeText(context, node) {
  const services = context.sourceCode.parserServices;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) return "";
  try {
    const checker = services.program.getTypeChecker();
    return checker.typeToString(
      checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node)),
    );
  } catch {
    return "";
  }
}

export default createRule({
  name: "no-sensitive-browser-storage",
  meta: {
    type: "problem",
    docs: {
      description: "WEB008: sensitive domain records cannot enter persistent browser storage",
    },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      sensitive:
        "WEB008 Sensitive authentication or conversation data cannot be persisted in browser storage.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      CallExpression(node) {
        if (
          !isMemberCall(node, "localStorage", ["setItem"]) &&
          !isMemberCall(node, "sessionStorage", ["setItem"])
        ) {
          return;
        }
        const value = node.arguments[1];
        if (!value || value.type === "SpreadElement") return;
        const source = context.sourceCode.getText(value);
        const inferred = typeText(context, value);
        if (SENSITIVE.test(`${source} ${inferred}`)) {
          context.report({ node, messageId: "sensitive" });
        }
      },
    };
  },
});
