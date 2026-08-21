import { createRule, matchesAnyPath, normalizedFilename } from "../rule-utils.mjs";

export default createRule({
  name: "no-upstream-html-proxy",
  meta: {
    type: "problem",
    docs: { description: "WEB009: remote HTML must not be re-served from the application origin" },
    schema: [
      {
        type: "object",
        properties: { allowFiles: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      proxy:
        "WEB009 Do not fetch upstream HTML and re-serve it from the application origin. Redirect, isolate on another origin, or render a trusted local client.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const filename = normalizedFilename(context);
    if (matchesAnyPath(filename, options.allowFiles)) return {};
    return {
      "Program:exit"(node) {
        const text = context.sourceCode.getText();
        const hasFetch = /\bfetch\s*\(/.test(text);
        const readsHTML = /\.text\s*\(\s*\)/.test(text);
        const servesHTML = /(?:content-type|Content-Type)["']?\s*[:),]\s*["']text\/html/i.test(
          text,
        );
        if (hasFetch && readsHTML && servesHTML) context.report({ node, messageId: "proxy" });
      },
    };
  },
});
