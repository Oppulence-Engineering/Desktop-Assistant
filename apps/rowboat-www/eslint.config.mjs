import jsxA11y from "eslint-plugin-jsx-a11y";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import oppulenceWeb from "@oppulence/eslint-plugin-web";
import tseslint from "typescript-eslint";

import componentArchitecture from "./config/architecture/component-baseline.json" with { type: "json" };

const typedFiles = [
  "app/(product)/**/*.{ts,tsx}",
  "lib/api/**/*.{ts,tsx}",
  "lib/storage/**/*.{ts,tsx}",
  "quality/**/*.{ts,tsx}",
  "scripts/**/*.{ts,tsx}",
];

const legacyTypedFiles = [
  "app/(product)/app/product-dashboard-client.tsx",
  "scripts/capture-marketing-screenshots.ts",
  "scripts/seed-demo-workspace.ts",
];

// These are known migration seams in the pre-App-Router dashboard. New files
// receive no exception; deleting an entry is the completion criterion for each
// slice of the migration.
const legacy = {
  productClientEntries: [],
  unvalidatedJson: [
    "app/api/download/route.ts",
    "app/api/openapi/route.ts",
    "app/(product)/app/product-dashboard-client.tsx",
    "app/plan-response/page.tsx",
    "components/agents/agent-configuration-form.tsx",
    "components/agents/agents-view.tsx",
    "components/app-settings.tsx",
    "components/app-shell.tsx",
    "lib/actions.ts",
    "lib/auth/client.ts",
    "lib/cloud-workflows.ts",
    "lib/revenue.ts",
    "scripts/capture-marketing-screenshots.ts",
  ],
  directFetch: [
    "app/plan-response/page.tsx",
    "components/ai-elements/prompt-input.tsx",
    "lib/auth/client.ts",
    "lib/auth/proxy.ts",
    "lib/auth/rowboat-api.ts",
    "scripts/capture-marketing-screenshots.ts",
    "scripts/run-lighthouse.mjs",
  ],
  asyncIntervals: ["components/workflows/cloud-workflows-view.tsx"],
  browserStorage: [
    "app/(product)/app/product-dashboard-client.tsx",
    "components/app-settings.tsx",
    "components/app-shell.tsx",
    "components/revenue-panel.tsx",
    "components/revenue/relationship-graph.tsx",
    "lib/console-prefs.ts",
  ],
  sensitiveStorage: [],
  fetchWithoutSignal: [
    "app/plan-response/page.tsx",
    "components/ai-elements/prompt-input.tsx",
    "scripts/capture-marketing-screenshots.ts",
  ],
  sensitiveConsole: [
    "app/(product)/app/product-dashboard-client.tsx",
    "components/app-shell.tsx",
    "components/ai-elements/prompt-input.tsx",
    "scripts/capture-marketing-screenshots.ts",
    "scripts/seed-demo-workspace.ts",
  ],
};

const reactCompilerRulesAsWarn = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/refs": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/static-components": "warn",
  "react-hooks/preserve-manual-memoization": "warn",
  "react-hooks/exhaustive-deps": "warn",
};

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "lib/api/generated/**",
      ".rowboat-contracts-*/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...tseslint.config({
    files: typedFiles,
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }),
  ...tseslint.config({
    files: legacyTypedFiles,
    extends: [tseslint.configs.disableTypeChecked],
  }),
  {
    files: ["**/*.{jsx,tsx}"],
    rules: Object.fromEntries(
      Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, "warn"]),
    ),
  },
  {
    plugins: { "oppulence-web": oppulenceWeb },
    rules: {
      "oppulence-web/product-pages-are-server": [
        "error",
        { allowFiles: legacy.productClientEntries },
      ],
      "oppulence-web/require-server-auth-layout": [
        "error",
        { allowFiles: legacy.productClientEntries },
      ],
      "oppulence-web/require-server-only": "error",
      "oppulence-web/no-unvalidated-json": ["error", { allowFiles: legacy.unvalidatedJson }],
      "oppulence-web/no-direct-api-fetch": ["error", { allowFiles: legacy.directFetch }],
      "oppulence-web/no-async-setinterval": ["error", { allowFiles: legacy.asyncIntervals }],
      "oppulence-web/no-raw-browser-storage": ["error", { allowFiles: legacy.browserStorage }],
      "oppulence-web/no-sensitive-browser-storage": [
        "error",
        { allowFiles: legacy.sensitiveStorage },
      ],
      "oppulence-web/no-upstream-html-proxy": "error",
      "oppulence-web/require-safe-proxy-headers": "error",
      "oppulence-web/require-abort-signal": ["error", { allowFiles: legacy.fetchWithoutSignal }],
      "oppulence-web/no-raw-upstream-errors": "error",
      "oppulence-web/no-sensitive-console": ["error", { allowFiles: legacy.sensitiveConsole }],
      "oppulence-web/no-client-server-imports": "error",
      "oppulence-web/standardized-component-location": [
        "error",
        {
          allowFiles: componentArchitecture.legacyFiles,
          allowPaths: [
            ...componentArchitecture.standardPaths,
            ...componentArchitecture.managedPaths,
          ],
        },
      ],
    },
  },
  {
    files: ["quality/eslint-plugin.test.ts"],
    rules: Object.fromEntries(
      Object.keys(oppulenceWeb.rules).map((rule) => [`oppulence-web/${rule}`, "off"]),
    ),
  },
  {
    rules: reactCompilerRulesAsWarn,
  },
];

export default config;
