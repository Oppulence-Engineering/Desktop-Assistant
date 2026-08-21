import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import xArchitecture from "@x/eslint-plugin-x-architecture";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "architecture-baseline.json"), "utf8"),
) as {
  containerResolve: Record<string, number>;
  unsafeFsWrites: Record<string, number>;
  unboundedPollers: Record<string, number>;
  unvalidatedFsReads: Record<string, number>;
};

const unusedVarsRule = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
} as const;

const typedRuleTuning = {
  ...unusedVarsRule,
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unsafe-argument": "warn",
  "@typescript-eslint/no-unsafe-assignment": "warn",
  "@typescript-eslint/no-unsafe-call": "warn",
  "@typescript-eslint/no-unsafe-member-access": "warn",
  "@typescript-eslint/no-unsafe-return": "warn",
  "@typescript-eslint/no-unnecessary-condition": "warn",
  "@typescript-eslint/no-base-to-string": "warn",
  "@typescript-eslint/no-confusing-void-expression": "warn",
  "@typescript-eslint/no-non-null-assertion": "warn",
  "@typescript-eslint/no-unnecessary-boolean-literal-compare": "warn",
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  "@typescript-eslint/no-unnecessary-type-conversion": "warn",
  "@typescript-eslint/no-unnecessary-type-parameters": "warn",
  "@typescript-eslint/no-deprecated": "warn",
  "@typescript-eslint/no-dynamic-delete": "warn",
  "@typescript-eslint/no-meaningless-void-operator": "warn",
  "@typescript-eslint/no-extraneous-class": "warn",
  "@typescript-eslint/no-implied-eval": "warn",
  "@typescript-eslint/no-invalid-void-type": "warn",
  "@typescript-eslint/no-misused-spread": "warn",
  "@typescript-eslint/no-redundant-type-constituents": "warn",
  "@typescript-eslint/no-unnecessary-template-expression": "warn",
  "@typescript-eslint/no-unsafe-enum-comparison": "warn",
  "@typescript-eslint/prefer-promise-reject-errors": "warn",
  "@typescript-eslint/restrict-plus-operands": "warn",
  "@typescript-eslint/return-await": "warn",
  "@typescript-eslint/unbound-method": "warn",
  "@typescript-eslint/await-thenable": "warn",
  "@typescript-eslint/require-await": "warn",
  "@typescript-eslint/restrict-template-expressions": "warn",
  "@typescript-eslint/no-floating-promises": "warn",
  "@typescript-eslint/no-misused-promises": "warn",
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "warn",
  "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@x/core/dist/**", "@x/shared/dist/**", "@x/core/src/**", "@x/shared/src/**"],
          message: "Import from the package root or a declared package subpath.",
        },
      ],
    },
  ],
  "x-architecture/no-deep-dist-imports": "error",
} as const;

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/.package/**",
    "**/out/**",
    "**/node_modules/**",
    "packages/core/vendor/**",
    "packages/core/src/knowledge/chrome-extension/**",
  ]),

  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    plugins: {
      boundaries,
      "x-architecture": xArchitecture,
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["apps/main/playwright.config.ts", "packages/core/vitest.config.ts"],
        },
        tsconfigRootDir: repoRoot,
      },
    },
    settings: {
      "boundaries/elements": [
        { type: "renderer", pattern: "apps/renderer/src/**" },
        { type: "preload", pattern: "apps/preload/src/**" },
        { type: "main", pattern: "apps/main/src/**" },
        { type: "core", pattern: "packages/core/src/**" },
        { type: "shared", pattern: "packages/shared/src/**" },
      ],
    },
    rules: {
      ...typedRuleTuning,
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: { element: { type: "core" } },
              disallow: { to: { element: { types: { anyOf: ["main", "preload", "renderer"] } } } },
            },
            {
              from: { element: { type: "renderer" } },
              disallow: { to: { element: { types: { anyOf: ["main", "preload", "core"] } } } },
            },
            {
              from: { element: { type: "preload" } },
              disallow: { to: { element: { types: { anyOf: ["main", "renderer", "core"] } } } },
            },
          ],
        },
      ],
    },
  },

  {
    files: ["apps/main/**/*.ts", "packages/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ["apps/renderer/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "x-architecture/typed-renderer-events": "error" },
  },

  {
    files: ["apps/renderer/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-refresh/only-export-components": "warn",
    },
  },

  {
    files: ["apps/renderer/src/lib/renderer-events.ts"],
    rules: { "x-architecture/typed-renderer-events": "off" },
  },

  {
    files: ["apps/preload/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "x-architecture/no-raw-ipc-renderer-exposure": "error" },
  },

  {
    files: ["packages/core/src/**/*.ts"],
    rules: { "x-architecture/no-electron-in-core": "error" },
  },

  {
    files: ["apps/main/src/**/*.ts", "packages/core/src/**/*.ts"],
    rules: {
      "x-architecture/no-container-resolve": ["error", { baseline: baseline.containerResolve }],
      "x-architecture/no-unsafe-fs-write": ["error", { baseline: baseline.unsafeFsWrites }],
      "x-architecture/no-unbounded-poller": ["error", { baseline: baseline.unboundedPollers }],
      "x-architecture/no-unvalidated-fs-read": ["error", { baseline: baseline.unvalidatedFsReads }],
    },
  },

  {
    files: ["apps/main/src/**/*.ts"],
    rules: {
      "x-architecture/ipc-sender-validation": "error",
      "x-architecture/no-dangerous-electron-options": "error",
      "x-architecture/no-raw-ipc": "error",
      "x-architecture/no-untrusted-open-external": "error",
    },
  },

  {
    files: [
      "apps/main/src/ipc.ts",
      "apps/main/src/renderer-events.ts",
      "apps/main/src/external-url.ts",
    ],
    rules: {
      "x-architecture/ipc-sender-validation": "off",
      "x-architecture/no-raw-ipc": "off",
      "x-architecture/no-untrusted-open-external": "off",
    },
  },

  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.testkit.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "x-architecture/no-unsafe-fs-write": "off",
      "x-architecture/no-unvalidated-fs-read": "off",
    },
  },
  {
    files: ["apps/main/playwright.config.ts", "packages/core/vitest.config.ts"],
    rules: { "@typescript-eslint/no-useless-default-assignment": "off" },
  },
]);
