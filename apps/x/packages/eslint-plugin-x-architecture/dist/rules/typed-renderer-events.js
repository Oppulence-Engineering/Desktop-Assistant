import { createRule } from "../create-rule.js";
import { memberName, rootIdentifier } from "../utils.js";
const browserEvents = new Set([
    "abort",
    "beforeunload",
    "blur",
    "change",
    "click",
    "error",
    "focus",
    "input",
    "keydown",
    "keyup",
    "load",
    "message",
    "online",
    "offline",
    "resize",
    "scroll",
    "submit",
    "unhandledrejection",
]);
export const typedRendererEvents = createRule({
    name: "typed-renderer-events",
    meta: {
        type: "problem",
        docs: { description: "Route application DOM events through the typed renderer event module." },
        schema: [],
        messages: {
            forbidden: "X013: application event '{{event}}' must use emitRendererEvent/onRendererEvent.",
        },
    },
    defaultOptions: [],
    create(context) {
        return {
            CallExpression(node) {
                if (rootIdentifier(node.callee) !== "window")
                    return;
                const method = memberName(node.callee);
                if (method !== "addEventListener" && method !== "dispatchEvent")
                    return;
                if (method === "addEventListener") {
                    const first = node.arguments[0];
                    if (first?.type === "Literal" &&
                        typeof first.value === "string" &&
                        !browserEvents.has(first.value)) {
                        context.report({ node, messageId: "forbidden", data: { event: first.value } });
                    }
                    return;
                }
                const first = node.arguments[0];
                if (first?.type !== "NewExpression" || first.callee.type !== "Identifier")
                    return;
                if (first.callee.name !== "Event" && first.callee.name !== "CustomEvent")
                    return;
                const eventArg = first.arguments[0];
                if (eventArg?.type === "Literal" &&
                    typeof eventArg.value === "string" &&
                    !browserEvents.has(eventArg.value)) {
                    context.report({ node, messageId: "forbidden", data: { event: eventArg.value } });
                }
            },
        };
    },
});
