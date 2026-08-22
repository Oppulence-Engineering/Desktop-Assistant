import { createRule, hasDirective } from "../rule-utils.mjs";

const SERVER_IMPORT =
  /(?:^|\/)(?:lib\/)?(?:api\/server|bff|secrets|workos)(?:\/|$)|@\/lib\/auth\/(?:config|cookies|jwt|origin|pkce|proxy|rowboat-api)$/;

export default createRule({
  name: "no-client-server-imports",
  meta: {
    type: "problem",
    docs: {
      description:
        "WEB014: Client Components cannot import server modules or private environment values",
    },
    schema: [],
    messages: {
      serverImport: "WEB014 Client Component cannot import server-only module {{source}}.",
      privateEnv:
        "WEB014 Client Component cannot read non-NEXT_PUBLIC environment variable {{name}}.",
    },
  },
  defaultOptions: [],
  create(context) {
    if (!hasDirective(context.sourceCode, "use client")) return {};
    return {
      ImportDeclaration(node) {
        if (SERVER_IMPORT.test(String(node.source.value))) {
          context.report({
            node,
            messageId: "serverImport",
            data: { source: String(node.source.value) },
          });
        }
      },
      MemberExpression(node) {
        if (
          node.object.type !== "MemberExpression" ||
          node.object.object.type !== "Identifier" ||
          node.object.object.name !== "process" ||
          node.object.property.type !== "Identifier" ||
          node.object.property.name !== "env"
        ) {
          return;
        }
        const name =
          node.property.type === "Identifier" ? node.property.name : String(node.property.value);
        if (!name.startsWith("NEXT_PUBLIC_")) {
          context.report({ node, messageId: "privateEnv", data: { name } });
        }
      },
    };
  },
});
