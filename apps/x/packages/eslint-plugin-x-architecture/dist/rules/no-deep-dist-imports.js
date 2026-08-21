import { createRule } from "../create-rule.js";
const deepImport = /^@x\/(?:core|shared)\/(?:dist|src)(?:\/|$)/;
export const noDeepDistImports = createRule({
    name: "no-deep-dist-imports",
    meta: {
        type: "problem",
        docs: { description: "Require declared @x/core and @x/shared package subpaths." },
        schema: [],
        messages: { forbidden: "X002: import '{{source}}' bypasses the package exports contract." },
    },
    defaultOptions: [],
    create(context) {
        const check = (node) => {
            const source = node.source?.value;
            if (typeof source === "string" && deepImport.test(source)) {
                context.report({ node, messageId: "forbidden", data: { source } });
            }
        };
        return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
    },
});
