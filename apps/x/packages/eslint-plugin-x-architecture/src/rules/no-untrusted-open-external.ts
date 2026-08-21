import { createRule } from "../create-rule.js";
import { memberName, rootIdentifier } from "../utils.js";

export const noUntrustedOpenExternal = createRule({
  name: "no-untrusted-open-external",
  meta: {
    type: "problem",
    docs: { description: "Require URL validation before opening an external application." },
    schema: [],
    messages: {
      forbidden: "X016: use openTrustedExternal() so URL protocol and trust are validated.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (rootIdentifier(node.callee) === "shell" && memberName(node.callee) === "openExternal") {
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
});
