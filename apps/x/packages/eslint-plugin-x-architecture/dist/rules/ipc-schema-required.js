import { createRule } from "../create-rule.js";
export const ipcSchemaRequired = createRule({
    name: "ipc-schema-required",
    meta: {
        type: "suggestion",
        docs: {
            description: "Document the shared-schema requirement enforced by the raw IPC boundary rule.",
        },
        schema: [],
        messages: { forbidden: "X004: IPC channels require shared request and response schemas." },
    },
    defaultOptions: [],
    create() {
        return {};
    },
});
