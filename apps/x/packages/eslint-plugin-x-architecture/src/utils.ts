import type { TSESTree } from "@typescript-eslint/utils";

export type BaselineOptions = [{ baseline?: Record<string, number> }];

export function normalizedFilename(filename: string): string {
  return filename.replaceAll("\\", "/");
}

export function baselineLimit(
  filename: string,
  baseline: Record<string, number> | undefined,
): number {
  const normalized = normalizedFilename(filename);
  for (const [suffix, count] of Object.entries(baseline ?? {})) {
    if (normalized.endsWith(suffix)) return count;
  }
  return 0;
}

export function memberName(node: TSESTree.Node | null | undefined): string | null {
  if (!node || node.type !== "MemberExpression" || node.computed) return null;
  return node.property.type === "Identifier" ? node.property.name : null;
}

export function rootIdentifier(node: TSESTree.Node | null | undefined): string | null {
  let current = node;
  while (current?.type === "MemberExpression") current = current.object;
  return current?.type === "Identifier" ? current.name : null;
}

export function isLiteralTrue(node: TSESTree.Node): boolean {
  return node.type === "Literal" && node.value === true;
}

export function isLiteralFalse(node: TSESTree.Node): boolean {
  return node.type === "Literal" && node.value === false;
}
