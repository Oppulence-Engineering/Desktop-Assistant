import fs from "node:fs";
import path from "node:path";

import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

function findProductRoot(filename) {
  const normalized = filename.replaceAll(path.sep, "/");
  const marker = normalized.includes("/app/(product)/app/") ? "/app/(product)/app/" : "/app/app/";
  const index = normalized.indexOf(marker);
  return index === -1 ? null : normalized.slice(0, index + marker.length - 1);
}

export default createRule({
  name: "require-server-auth-layout",
  meta: {
    type: "problem",
    docs: {
      description: "WEB002: protected product pages must inherit a server-authenticated layout",
    },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      missing:
        "WEB002 Protected product route does not inherit a server-authenticated layout containing requireSession(). Client authentication is not a security boundary.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const relative = normalizedFilename(context);
    if (!relative.endsWith("/page.tsx") || matchesAnyPath(relative, options.allowFiles)) return {};
    const absolute = context.filename || context.getFilename();
    const root = findProductRoot(absolute);
    if (!root) return {};

    return {
      Program(node) {
        let directory = path.dirname(absolute);
        while (directory.startsWith(root)) {
          const layout = path.join(directory, "layout.tsx");
          if (
            fs.existsSync(layout) &&
            /\brequireSession\s*\(/.test(fs.readFileSync(layout, "utf8"))
          ) {
            return;
          }
          if (directory === root) break;
          directory = path.dirname(directory);
        }
        context.report({ node, messageId: "missing" });
      },
    };
  },
});
