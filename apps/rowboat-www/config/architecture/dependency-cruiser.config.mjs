/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
  forbidden: [
    {
      name: "WEB014-no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "marketing-does-not-depend-on-product",
      severity: "error",
      from: { path: "^app/\\(marketing\\)/" },
      to: {
        path: "^(app/\\(product\\)|components/(?:agents|workflows)|lib/(?:actions|cloud-workflows|revenue))",
      },
    },
    {
      name: "shared-ui-does-not-import-application-code",
      severity: "error",
      from: { path: "^../../packages/ui/src/" },
      to: { path: "^apps/rowboat-www/" },
    },
    {
      name: "client-layers-do-not-import-private-auth",
      severity: "error",
      from: { path: "^(components|hooks)/" },
      to: {
        path: "^lib/auth/(?:config|cookies|jwt|origin|pkce|proxy|rowboat-api)\\.(?:ts|tsx)$",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: "(^|/)(?:node_modules|\\.next|coverage|lib/api/generated)(?:/|$)",
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};

export default config;
