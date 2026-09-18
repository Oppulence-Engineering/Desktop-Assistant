import bundleAnalyzer from "@next/bundle-analyzer";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import path from "path";
import uiPackage from "../../packages/ui/package.json" with { type: "json" };
import { isDevelopment } from "./lib/environment";

const repoRoot = path.join(__dirname, "../..");

type Bundler = "webpack" | "turbopack";

/** Normalize alias targets for Turbopack (repo-root-relative, forward slashes). */
function toTurbopackAliasTarget(...segments: string[]): string {
  return path
    .join(...segments)
    .split(path.sep)
    .join("/");
}

/**
 * @oppulence/ui is file:-linked; pin its runtime deps to this app's node_modules.
 * Webpack accepts absolute paths; Turbopack prepends `./` to alias targets, so absolute
 * paths become invalid server-relative imports — use repo-root-relative paths instead.
 */
function uiPackageResolveAlias(bundler: Bundler): Record<string, string> {
  const appNodeModulesAbs = path.join(__dirname, "node_modules");
  const uiSrcAbs = path.join(repoRoot, "packages/ui/src");
  const runtimeDeps = Object.keys(uiPackage.dependencies ?? {});

  const depPath = (dep: string) =>
    bundler === "turbopack"
      ? toTurbopackAliasTarget("apps/rowboat-www/node_modules", dep)
      : path.join(appNodeModulesAbs, dep);

  const uiInternal = (suffix: string) =>
    bundler === "turbopack"
      ? toTurbopackAliasTarget("packages/ui/src", suffix)
      : path.join(uiSrcAbs, suffix);

  const aliases = Object.fromEntries(runtimeDeps.map((dep) => [dep, depPath(dep)]));

  return {
    ...aliases,
    react: depPath("react"),
    "react-dom": depPath("react-dom"),
    "#lib/utils": uiInternal("lib/utils.ts"),
    "#lib/icons": uiInternal("lib/icons.tsx"),
    "#components": uiInternal("components"),
  };
}

const withMDX = createMDX({
  configPath: "config/fumadocs/source.config.ts",
});

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Plain's chat widget loads its script from a CDN, talks to the UK chat API,
// and pulls the workspace logo, attachments, and Gravatar-backed agent avatars
// from Plain-owned buckets. Every origin here is required by
// https://www.plain.com/docs/product/channels/chat — the widget silently fails
// to render if any of them is missing.
const plainChat = {
  script: "https://chat.cdn-plain.com",
  connect: [
    "https://chat.uk.plain.com",
    "https://prod-uk-services-attachm-attachmentsuploadbucket2-1l2e4906o2asm.s3.eu-west-2.amazonaws.com",
  ],
  style: "https://fonts.googleapis.com",
  img: [
    "https://prod-uk-services-workspac-workspacefilespublicbuck-vs4gjqpqjkh6.s3.amazonaws.com",
    "https://prod-uk-services-attachm-attachmentsbucket28b3ccf-uwfssb4vt2us.s3.eu-west-2.amazonaws.com",
    "https://i0.wp.com",
  ],
};

// react-grab loads from unpkg in dev and talks to a local MCP server (Cursor 5567,
// Claude 4567, Gemini 5568, OpenCode 6567). Keep these origins dev-only.
const reactGrabDev = {
  script: "https://unpkg.com",
  connect: [
    "http://localhost:4567",
    "http://localhost:5567",
    "http://localhost:5568",
    "http://localhost:6567",
  ],
};

const developmentBuild = isDevelopment();

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${plainChat.script}${developmentBuild ? ` ${reactGrabDev.script} 'unsafe-eval'` : ""}`,
  `style-src 'self' 'unsafe-inline' ${plainChat.style}`,
  `img-src 'self' data: blob: ${plainChat.img.join(" ")}`,
  `font-src 'self' data: ${plainChat.style} ${plainChat.script}`,
  `connect-src 'self' https://api.workos.com https://us.i.posthog.com ${plainChat.connect.join(" ")}${developmentBuild ? ` ${reactGrabDev.connect.join(" ")}` : ""}`,
  "frame-src 'self' https://api.oppulence.io https://api.x.staging.oppulence.io",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
  },
] satisfies Array<{ key: string; value: string }>;

const nextConfig: NextConfig = {
  // Instant Navigations (Next 16.3): prefetchable loading shells + partial
  // prefetching for instant page transitions.
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@oppulence/ui",
    "@sim/emcn",
    "@sim/workflow-renderer",
    "@sim/workflow-types",
    "@sim/utils",
  ],
  // Cursor's embedded browser uses the loopback IP. Without this development
  // exception Next blocks client chunks, leaving the app before hydration on
  // the server-rendered "Checking session" fallback indefinitely.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true,
  },
  async redirects() {
    // Legal pages moved to canonical short paths.
    return [
      { source: "/legal/terms-of-service", destination: "/terms", permanent: true },
      { source: "/legal/privacy-policy", destination: "/privacy", permanent: true },
      // Preserve old external links while keeping the current experience self-serve.
      { source: "/book-a-demo", destination: "/pricing", permanent: true },
      // /voice was a feature essay; the product page for Voice lives at
      // /voice-app alongside /web and /desktop.
      { source: "/voice", destination: "/voice-app", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...uiPackageResolveAlias("webpack"),
    };
    return config;
  },
  turbopack: {
    // Relationship contracts are shared with the desktop from the repository
    // package boundary, so Turbopack must be allowed to trace that package.
    root: repoRoot,
    resolveAlias: uiPackageResolveAlias("turbopack"),
  },
};

export default withBundleAnalyzer(withMDX(nextConfig));
