import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../create-rule.js";
import { baselineLimit, memberName, rootIdentifier, type BaselineOptions } from "../utils.js";

export const noUnvalidatedFsRead = createRule<BaselineOptions, "forbidden">({
  name: "no-unvalidated-fs-read",
  meta: {
    type: "problem",
    docs: { description: "Reject directly parsing a filesystem read as trusted JSON." },
    schema: [
      {
        type: "object",
        properties: { baseline: { type: "object", additionalProperties: { type: "number" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden: "X010: persisted JSON must be read through a schema-validating helper.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const nodes: TSESTree.CallExpression[] = [];
    return {
      CallExpression(node) {
        if (rootIdentifier(node.callee) !== "JSON" || memberName(node.callee) !== "parse") return;
        const argument = node.arguments[0];
        const awaited = argument?.type === "AwaitExpression" ? argument.argument : argument;
        if (awaited?.type === "CallExpression" && memberName(awaited.callee) === "readFile") {
          nodes.push(node);
        }
      },
      "Program:exit"() {
        const limit = baselineLimit(context.filename, options.baseline);
        for (const node of nodes.slice(limit)) context.report({ node, messageId: "forbidden" });
      },
    };
  },
});
