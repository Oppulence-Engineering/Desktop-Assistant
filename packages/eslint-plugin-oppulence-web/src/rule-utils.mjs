import path from "node:path";

import { ESLintUtils } from "@typescript-eslint/utils";

export const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/Oppulence-Engineering/Desktop-Assistant/tree/main/packages/eslint-plugin-oppulence-web#${name}`,
);

export function normalizedFilename(context) {
  const filename = context.filename || context.getFilename();
  return path.relative(process.cwd(), filename).replaceAll(path.sep, "/");
}

export function matchesAnyPath(filename, patterns = []) {
  return patterns.some(
    (pattern) => filename === pattern || filename.endsWith(pattern) || filename.includes(pattern),
  );
}

export function hasDirective(sourceCode, directive) {
  return sourceCode.ast.body.some(
    (node) => node.type === "ExpressionStatement" && node.directive === directive,
  );
}

export function propertyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

export function isMemberCall(node, objectName, methodNames) {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
  const method = propertyName(node.callee.property);
  if (!method || !methodNames.includes(method)) return false;
  const object = node.callee.object;
  if (object.type === "Identifier") return object.name === objectName;
  return object.type === "MemberExpression" && propertyName(object.property) === objectName;
}

export const pathOptionsSchema = [
  {
    type: "object",
    properties: {
      allowFiles: { type: "array", items: { type: "string" } },
      allowPaths: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
];
