import { createRule } from "../create-rule.js";
import { isLiteralFalse, isLiteralTrue } from "../utils.js";
const expected = new Map([
    ["nodeIntegration", false],
    ["contextIsolation", true],
    ["sandbox", true],
    ["webSecurity", true],
    ["allowRunningInsecureContent", false],
    ["enableRemoteModule", false],
]);
export const noDangerousElectronOptions = createRule({
    name: "no-dangerous-electron-options",
    meta: {
        type: "problem",
        docs: { description: "Reject dangerous Electron webPreferences values." },
        schema: [],
        messages: { forbidden: "X015: Electron option '{{name}}' must be {{expected}}." },
    },
    defaultOptions: [],
    create(context) {
        return {
            Property(node) {
                const name = node.key.type === "Identifier"
                    ? node.key.name
                    : node.key.type === "Literal"
                        ? String(node.key.value)
                        : null;
                if (!name || !expected.has(name))
                    return;
                const desired = expected.get(name);
                const violates = desired ? isLiteralFalse(node.value) : isLiteralTrue(node.value);
                if (violates)
                    context.report({
                        node,
                        messageId: "forbidden",
                        data: { name, expected: String(desired) },
                    });
            },
        };
    },
});
