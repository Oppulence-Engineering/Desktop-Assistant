import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

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
    ignores: [".next/**", "node_modules/**", "out/**"],
  },
  ...nextCoreWebVitals,
  {
    rules: reactCompilerRulesAsWarn,
  },
];

export default config;
