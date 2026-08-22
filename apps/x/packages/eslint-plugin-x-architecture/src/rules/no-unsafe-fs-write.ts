import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../create-rule.js";
import { baselineLimit, memberName, rootIdentifier, type BaselineOptions } from "../utils.js";

const writeMethods = new Set(["writeFile", "writeFileSync", "appendFile", "appendFileSync"]);

export const noUnsafeFsWrite = createRule<BaselineOptions, "forbidden">({
  name: "no-unsafe-fs-write",
  meta: {
    type: "problem",
    docs: { description: "Freeze direct filesystem persistence writes outside the safety layer." },
    schema: [
      {
        type: "object",
        properties: { baseline: { type: "object", additionalProperties: { type: "number" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden:
        "X009: use an atomic/repository persistence API instead of a new direct filesystem write.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const calls: TSESTree.CallExpression[] = [];
    return {
      CallExpression(node) {
        const method = memberName(node.callee);
        const root = rootIdentifier(node.callee);
        if (method && writeMethods.has(method) && (root === "fs" || root === "fsp"))
          calls.push(node);
      },
      "Program:exit"() {
        const limit = baselineLimit(context.filename, options.baseline);
        for (const node of calls.slice(limit)) context.report({ node, messageId: "forbidden" });
      },
    };
  },
});
