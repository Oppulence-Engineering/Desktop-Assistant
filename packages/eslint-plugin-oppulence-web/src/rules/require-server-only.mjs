import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

const SERVER_PATHS = [
  "lib/auth/config.ts",
  "lib/auth/cookies.ts",
  "lib/auth/jwt.ts",
  "lib/auth/origin.ts",
  "lib/auth/pkce.ts",
  "lib/auth/proxy.ts",
  "lib/auth/rowboat-api.ts",
  "lib/auth/session.ts",
  "lib/api/server/",
  "lib/bff/",
  "lib/secrets/",
  "lib/workos/",
];

export default createRule({
  name: "require-server-only",
  meta: {
    type: "problem",
    docs: { description: "WEB003: server-sensitive modules must import server-only" },
    schema: [],
    messages: { missing: 'WEB003 Server-sensitive module must begin with `import "server-only"`.' },
  },
  defaultOptions: [],
  create(context) {
    const filename = normalizedFilename(context);
    if (!matchesAnyPath(filename, SERVER_PATHS) || /\.(?:test|spec)\./.test(filename)) return {};
    return {
      Program(node) {
        const marked = node.body.some(
          (statement) =>
            statement.type === "ImportDeclaration" && statement.source.value === "server-only",
        );
        if (!marked) context.report({ node, messageId: "missing" });
      },
    };
  },
});
