import noAsyncSetInterval from "./rules/no-async-setinterval.mjs";
import noClientServerImports from "./rules/no-client-server-imports.mjs";
import noDirectApiFetch from "./rules/no-direct-api-fetch.mjs";
import noRawBrowserStorage from "./rules/no-raw-browser-storage.mjs";
import noRawUpstreamErrors from "./rules/no-raw-upstream-errors.mjs";
import noSensitiveBrowserStorage from "./rules/no-sensitive-browser-storage.mjs";
import noSensitiveConsole from "./rules/no-sensitive-console.mjs";
import noUnvalidatedJson from "./rules/no-unvalidated-json.mjs";
import noUpstreamHtmlProxy from "./rules/no-upstream-html-proxy.mjs";
import productPagesAreServer from "./rules/product-pages-are-server.mjs";
import requireAbortSignal from "./rules/require-abort-signal.mjs";
import requireSafeProxyHeaders from "./rules/require-safe-proxy-headers.mjs";
import requireServerAuthLayout from "./rules/require-server-auth-layout.mjs";
import requireServerOnly from "./rules/require-server-only.mjs";
import standardizedComponentLocation from "./rules/standardized-component-location.mjs";

export const rules = {
  "product-pages-are-server": productPagesAreServer,
  "require-server-auth-layout": requireServerAuthLayout,
  "require-server-only": requireServerOnly,
  "no-unvalidated-json": noUnvalidatedJson,
  "no-direct-api-fetch": noDirectApiFetch,
  "no-async-setinterval": noAsyncSetInterval,
  "no-raw-browser-storage": noRawBrowserStorage,
  "no-sensitive-browser-storage": noSensitiveBrowserStorage,
  "no-upstream-html-proxy": noUpstreamHtmlProxy,
  "require-safe-proxy-headers": requireSafeProxyHeaders,
  "require-abort-signal": requireAbortSignal,
  "no-raw-upstream-errors": noRawUpstreamErrors,
  "no-sensitive-console": noSensitiveConsole,
  "no-client-server-imports": noClientServerImports,
  "standardized-component-location": standardizedComponentLocation,
};

export default { rules };
