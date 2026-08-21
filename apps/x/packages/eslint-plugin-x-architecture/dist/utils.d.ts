import type { TSESTree } from "@typescript-eslint/utils";
export type BaselineOptions = [{
    baseline?: Record<string, number>;
}];
export declare function normalizedFilename(filename: string): string;
export declare function baselineLimit(filename: string, baseline: Record<string, number> | undefined): number;
export declare function memberName(node: TSESTree.Node | null | undefined): string | null;
export declare function rootIdentifier(node: TSESTree.Node | null | undefined): string | null;
export declare function isLiteralTrue(node: TSESTree.Node): boolean;
export declare function isLiteralFalse(node: TSESTree.Node): boolean;
