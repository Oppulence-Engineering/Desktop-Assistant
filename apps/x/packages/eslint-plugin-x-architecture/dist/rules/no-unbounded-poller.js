import { createRule } from "../create-rule.js";
import { baselineLimit } from "../utils.js";
export const noUnboundedPoller = createRule({
    name: "no-unbounded-poller",
    meta: {
        type: "problem",
        docs: { description: "Prevent new polling loops without cancellation ownership." },
        schema: [
            {
                type: "object",
                properties: { baseline: { type: "object", additionalProperties: { type: "number" } } },
                additionalProperties: false,
            },
        ],
        messages: {
            forbidden: "X014: long-lived polling must be owned by a LifecycleService and support cancellation.",
        },
    },
    defaultOptions: [{}],
    create(context, [options]) {
        const nodes = [];
        return {
            CallExpression(node) {
                if (node.callee.type === "Identifier" && node.callee.name === "setInterval")
                    nodes.push(node);
            },
            WhileStatement(node) {
                if (node.test.type === "Literal" && node.test.value === true)
                    nodes.push(node);
            },
            "Program:exit"() {
                const limit = baselineLimit(context.filename, options.baseline);
                for (const node of nodes.slice(limit))
                    context.report({ node, messageId: "forbidden" });
            },
        };
    },
});
