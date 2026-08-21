import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../create-rule.js";
import { baselineLimit, memberName, rootIdentifier, type BaselineOptions } from "../utils.js";

export const noContainerResolve = createRule<BaselineOptions, "forbidden">({
  name: "no-container-resolve",
  meta: {
    type: "problem",
    docs: { description: "Prevent growth of global Awilix service-location calls." },
    schema: [
      {
        type: "object",
        properties: { baseline: { type: "object", additionalProperties: { type: "number" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden: "X012: inject this dependency instead of adding a new container.resolve() call.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const calls: TSESTree.CallExpression[] = [];
    return {
      CallExpression(node) {
        if (memberName(node.callee) === "resolve" && rootIdentifier(node.callee) === "container")
          calls.push(node);
      },
      "Program:exit"() {
        const limit = baselineLimit(context.filename, options.baseline);
        for (const node of calls.slice(limit)) context.report({ node, messageId: "forbidden" });
      },
    };
  },
});
