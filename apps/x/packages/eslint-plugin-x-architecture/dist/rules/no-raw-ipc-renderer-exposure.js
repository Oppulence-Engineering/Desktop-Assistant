import { createRule } from "../create-rule.js";
import { rootIdentifier } from "../utils.js";
export const noRawIpcRendererExposure = createRule({
    name: "no-raw-ipc-renderer-exposure",
    meta: {
        type: "problem",
        docs: { description: "Prevent contextBridge from exposing raw ipcRenderer capabilities." },
        schema: [],
        messages: { forbidden: "X008: never expose ipcRenderer directly through contextBridge." },
    },
    defaultOptions: [],
    create(context) {
        return {
            CallExpression(node) {
                if (rootIdentifier(node.callee) !== "contextBridge" || node.arguments.length < 2)
                    return;
                const exposed = node.arguments[1];
                if (exposed?.type === "Identifier" && exposed.name === "ipcRenderer") {
                    context.report({ node: exposed, messageId: "forbidden" });
                }
            },
        };
    },
});
