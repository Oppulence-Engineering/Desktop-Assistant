import {
  createRule,
  matchesAnyPath,
  normalizedFilename,
  pathOptionsSchema,
} from "../rule-utils.mjs";

export default createRule({
  name: "standardized-component-location",
  meta: {
    type: "problem",
    docs: {
      description: "WEB019: new React components must live in a standardized ownership root",
    },
    schema: pathOptionsSchema,
    messages: {
      location:
        "WEB019 React component is outside an approved feature, route-private, managed, or infrastructure root. Use `npm run component:new`.",
    },
  },
  defaultOptions: [
    {
      allowPaths: [
        "components/features/",
        "/_components/",
        "components/ai-elements/",
        "components/providers/",
      ],
    },
  ],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    const isProductComponent = filename.startsWith("components/") && filename.endsWith(".tsx");
    const isRouteComponent = filename.includes("/_components/") && filename.endsWith(".tsx");
    if (!isProductComponent && !isRouteComponent) return {};
    if (filename.endsWith(".test.tsx")) return {};
    if (
      matchesAnyPath(filename, options.allowFiles) ||
      matchesAnyPath(filename, options.allowPaths)
    ) {
      return {};
    }

    return {
      Program(node) {
        context.report({ node, messageId: "location" });
      },
    };
  },
});
