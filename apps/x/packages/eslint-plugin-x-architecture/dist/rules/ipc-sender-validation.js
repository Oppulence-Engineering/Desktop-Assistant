import { createRule } from "../create-rule.js";
import { memberName, rootIdentifier } from "../utils.js";
export const ipcSenderValidation = createRule({
    name: "ipc-sender-validation",
    meta: {
        type: "problem",
        docs: { description: "Require raw ipcMain handlers to use the trusted sender wrapper." },
        schema: [],
        messages: {
            forbidden: "X007: raw ipcMain registration bypasses centralized sender validation.",
        },
    },
    defaultOptions: [],
    create(context) {
        const hasCentralValidation = context.sourceCode.text.includes("assertTrustedIpcSender");
        return {
            CallExpression(node) {
                if (hasCentralValidation)
                    return;
                if (rootIdentifier(node.callee) === "ipcMain" &&
                    ["handle", "handleOnce", "on", "once"].includes(memberName(node.callee) ?? "")) {
                    context.report({ node, messageId: "forbidden" });
                }
            },
        };
    },
});
