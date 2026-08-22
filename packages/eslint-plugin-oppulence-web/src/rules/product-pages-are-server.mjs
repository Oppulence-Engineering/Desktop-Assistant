import { createRule, hasDirective, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

export default createRule({
  name: "product-pages-are-server",
  meta: {
    type: "problem",
    docs: { description: "WEB001: product pages and layouts must remain Server Components" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      clientPage:
        "WEB001 Product page/layout must remain a Server Component. Move interactivity into a focused Client Component.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    const isProductEntry = /app\/(?:\(product\)\/)?app\/.*(?:page|layout)\.(?:ts|tsx)$/.test(
      filename,
    );
    if (!isProductEntry || matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      Program(node) {
        if (hasDirective(context.sourceCode, "use client")) {
          context.report({ node, messageId: "clientPage" });
        }
      },
    };
  },
});
