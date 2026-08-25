import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import nextConfig from "../next.config";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(appRoot, "../..");

const allowedRootFiles = new Set([
  ".dockerignore",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  "AGENTS.md",
  "Dockerfile",
  "Dockerfile.dockerignore",
  "README.md",
  "components.json",
  "eslint.config.mjs",
  "global.d.ts",
  "next-env.d.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "proxy.ts",
  "tsconfig.json",
  "vitest.config.ts",
]);

function isLocalRootFile(filename: string): boolean {
  return (
    filename === ".DS_Store" || filename.startsWith(".env") || filename.endsWith(".tsbuildinfo")
  );
}

describe("repository architecture policies", () => {
  it("keeps the contributor-facing application root intentional", () => {
    const unexpectedFiles = fs
      .readdirSync(appRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((filename) => !allowedRootFiles.has(filename) && !isLocalRootFile(filename));

    expect(
      unexpectedFiles,
      "Move repository-owned configuration to config/, automation to scripts/, and engineering records to docs/",
    ).toEqual([]);
  });

  it("WEB015 configures the complete security header boundary", async () => {
    expect(typeof nextConfig).toBe("object");
    const configuredHeaders = await nextConfig.headers?.();
    const headers = new Map(
      configuredHeaders?.flatMap((entry) =>
        entry.headers.map((header) => [header.key, header.value]),
      ) ?? [],
    );

    for (const required of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(headers.has(required), `missing ${required}`).toBe(true);
    }
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
  });

  it("WEB016 gives the protected product root loading and error boundaries", () => {
    const productRoot = path.join(appRoot, "app/(product)/app");
    for (const filename of ["layout.tsx", "page.tsx", "loading.tsx", "error.tsx"]) {
      expect(fs.existsSync(path.join(productRoot, filename)), `missing ${filename}`).toBe(true);
    }
    expect(fs.readFileSync(path.join(productRoot, "layout.tsx"), "utf8")).toMatch(
      /requireSession\s*\(/,
    );
    for (const route of ["agents", "revenue", "settings", "workflows"]) {
      expect(
        fs.existsSync(path.join(productRoot, route, "page.tsx")),
        `missing /app/${route}`,
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(appRoot, "proxy.ts"), "utf8")).toContain('"/app/:path*"');
  });

  it("WEB017 deploys when application-owned shared packages change", () => {
    const workflowPath = path.join(repoRoot, ".github/workflows/rowboat-www-deploy.yml");
    const workflow = parse(fs.readFileSync(workflowPath, "utf8")) as {
      on?: { push?: { paths?: string[] } };
    };
    const paths = workflow.on?.push?.paths ?? [];

    for (const requiredPath of [
      "apps/rowboat-www/**",
      "packages/ui/**",
      "packages/relationship-contract/**",
      "packages/eslint-plugin-oppulence-web/**",
    ]) {
      expect(paths, `deploy workflow does not watch ${requiredPath}`).toContain(requiredPath);
    }
  });

  it("WEB018 keeps the source OpenAPI document and generator configuration in-repo", () => {
    expect(fs.existsSync(path.join(repoRoot, "apps/rowboat-api/api/openapi.json"))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, "config/contracts/orval.config.ts"))).toBe(true);
  });

  it("scans the immutable deployment image before rollout", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/rowboat-www-deploy.yml"),
      "utf8",
    );
    expect(workflow).toContain("osv-scanner/v2/cmd/osv-scanner@v2.5.1");
    expect(workflow).toContain("scan image");
    expect(workflow).toContain("--build-only");
    expect(workflow).toContain('--image "${IMAGE_REF}"');
  });
});
