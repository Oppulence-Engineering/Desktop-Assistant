/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "X001-core-is-electron-independent",
      severity: "error",
      comment: "Platform adapters are assembled in main; core remains portable.",
      from: { path: "^packages/core/src" },
      to: { path: "^(electron($|/)|apps/(main|preload|renderer)/)" },
    },
    {
      name: "X002-no-package-internals",
      severity: "error",
      from: { path: "^(apps|packages|tests|scripts|tools)" },
      to: { path: "@x/(core|shared)/(dist|src)/" },
    },
    {
      name: "X002-no-unresolvable-local-imports",
      severity: "error",
      from: { path: "^(apps|packages|tests|scripts|tools)" },
      to: {
        couldNotResolve: true,
        pathNot: "^(@/|@x/)",
        dependencyTypesNot: ["npm", "npm-dev", "npm-optional", "npm-peer"],
      },
    },
    {
      name: "XARCH-no-cycles",
      severity: "error",
      comment:
        "Existing cycles are visible while new service-location cycles are prevented by X012.",
      from: { path: "^(apps|packages)" },
      to: { circular: true },
    },
    {
      name: "XARCH-renderer-does-not-reach-privileged-code",
      severity: "error",
      from: { path: "^apps/renderer/src" },
      to: { path: "^(apps/(main|preload)/src|packages/core/src)" },
    },
    {
      name: "XARCH-preload-is-a-thin-bridge",
      severity: "error",
      from: { path: "^apps/preload/src" },
      to: { path: "^(apps/(main|renderer)/src|packages/core/src)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^|/)(dist|node_modules|vendor|\\.package|out)(/|$)|packages/core/src/knowledge/chrome-extension",
    },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "require", "default"],
      exportsFields: ["exports"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
