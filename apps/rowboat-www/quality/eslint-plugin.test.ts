import path from "node:path";
import { fileURLToPath } from "node:url";

import oppulenceWeb from "@oppulence/eslint-plugin-web";
import parser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function lint(rule: string, code: string, filename: string) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser,
          parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
        },
        plugins: { "oppulence-web": oppulenceWeb },
        rules: { [`oppulence-web/${rule}`]: "error" },
      },
    ],
    path.join(root, filename),
  );
}

const violations = [
  {
    rule: "product-pages-are-server",
    filename: "app/(product)/app/agents/page.tsx",
    code: '"use client"; export default function Page() { return null; }',
  },
  {
    rule: "require-server-auth-layout",
    filename: "quality/fixtures/noauth/app/(product)/app/page.tsx",
    code: "export default function Page() { return null; }",
  },
  {
    rule: "require-server-only",
    filename: "lib/auth/config.ts",
    code: "export const secret = process.env.SECRET;",
  },
  {
    rule: "no-unvalidated-json",
    filename: "lib/api/users.ts",
    code: "async function load(r: Response) { return (await r.json()) as User; }",
  },
  {
    rule: "no-direct-api-fetch",
    filename: "components/profile.tsx",
    code: 'export async function load() { return fetch("/api/me"); }',
  },
  {
    rule: "no-async-setinterval",
    filename: "components/poller.tsx",
    code: "setInterval(async () => { await Promise.resolve(); }, 1000);",
  },
  {
    rule: "no-raw-browser-storage",
    filename: "components/preferences.tsx",
    code: 'localStorage.setItem("theme", "dark");',
  },
  {
    rule: "no-sensitive-browser-storage",
    filename: "lib/storage/unsafe.ts",
    code: 'localStorage.setItem("chat", JSON.stringify(conversationItems));',
  },
  {
    rule: "no-upstream-html-proxy",
    filename: "app/api/reference/route.ts",
    code: 'const r = await fetch(url); const html = await r.text(); return new Response(html, { headers: { "Content-Type": "text/html" } });',
  },
  {
    rule: "require-safe-proxy-headers",
    filename: "lib/bff/proxy.ts",
    code: "request.headers.forEach((value, key) => headers.set(key, value));",
  },
  {
    rule: "require-abort-signal",
    filename: "lib/api/users.ts",
    code: 'fetch("/api/users", { method: "GET" });',
  },
  {
    rule: "no-raw-upstream-errors",
    filename: "app/api/auth/callback/route.ts",
    code: 'url.searchParams.set("error", error.message);',
  },
  {
    rule: "no-sensitive-console",
    filename: "components/chat.tsx",
    code: 'console.log("chat prompt", prompt);',
  },
  {
    rule: "no-client-server-imports",
    filename: "components/client.tsx",
    code: '"use client"; import { config } from "@/lib/auth/config";',
  },
  {
    rule: "standardized-component-location",
    filename: "components/agents/new-agent-card.tsx",
    code: "export function NewAgentCard() { return null; }",
  },
] as const;

describe("eslint-plugin-oppulence-web", () => {
  it.each(violations)("reports $rule", ({ rule, code, filename }) => {
    const messages = lint(rule, code, filename);
    expect(messages, messages.map((message) => message.message).join("\n")).toHaveLength(1);
    expect(messages[0]?.message).toMatch(/^WEB\d{3}/);
  });

  it("accepts a protected server page beneath an authenticated layout", () => {
    const messages = lint(
      "require-server-auth-layout",
      "export default function Page() { return null; }",
      "quality/fixtures/app/(product)/app/page.tsx",
    );
    expect(messages).toHaveLength(0);
  });

  it("accepts a component in the standardized feature root", () => {
    const messages = lint(
      "standardized-component-location",
      "export function AgentCard() { return null; }",
      "components/features/agents/agent-card/agent-card.tsx",
    );
    expect(messages).toHaveLength(0);
  });
});
