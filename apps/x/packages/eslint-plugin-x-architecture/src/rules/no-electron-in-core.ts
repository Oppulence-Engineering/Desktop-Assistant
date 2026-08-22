import type { TSESTree } from "@typescript-eslint/utils";
import { createRule } from "../create-rule.js";

const forbidden = /^(?:electron(?:\/|$)|apps\/(?:main|preload|renderer)(?:\/|$))/;

export const noElectronInCore = createRule({
  name: "no-electron-in-core",
  meta: {
    type: "problem",
    docs: { description: "Keep packages/core independent of Electron and app layers." },
    schema: [],
    messages: {
      forbidden:
        "X001: packages/core cannot import '{{source}}'. Keep Electron at the application edge.",
    },
  },
  defaultOptions: [],
  create(context) {
    const check = (
      node:
        | TSESTree.ImportDeclaration
        | TSESTree.ExportNamedDeclaration
        | TSESTree.ExportAllDeclaration,
    ) => {
      const source = node.source?.value;
      if (typeof source === "string" && forbidden.test(source)) {
        context.report({ node, messageId: "forbidden", data: { source } });
      }
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
  },
});
