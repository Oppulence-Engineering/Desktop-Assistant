import { createRule } from "../create-rule.js";
import { memberName, rootIdentifier } from "../utils.js";

const rawMethods = new Set(["handle", "handleOnce", "on", "once", "invoke", "send", "sendSync"]);

export const noRawIpc = createRule({
  name: "no-raw-ipc",
  meta: {
    type: "problem",
    docs: { description: "Keep raw Electron IPC inside the validated IPC adapters." },
    schema: [],
    messages: {
      forbidden: "X003: raw {{root}}.{{method}}() is only allowed in the validated IPC adapter.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        const root = rootIdentifier(node.callee);
        const method = memberName(node.callee);
        if ((root === "ipcMain" || root === "ipcRenderer") && method && rawMethods.has(method)) {
          context.report({ node, messageId: "forbidden", data: { root, method } });
        }
        if (
          method === "send" &&
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "MemberExpression" &&
          memberName(node.callee.object) === "webContents"
        ) {
          context.report({
            node,
            messageId: "forbidden",
            data: { root: "webContents", method: "send" },
          });
        }
      },
    };
  },
});
