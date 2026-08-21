import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import path from "path";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://us.i.posthog.com",
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
  transpilePackages: ["@oppulence/ui"],
  images: {
    unoptimized: true,
  },
  async redirects() {
    // Legal pages moved to canonical short paths.
    return [
      { source: "/legal/terms-of-service", destination: "/terms", permanent: true },
      { source: "/legal/privacy-policy", destination: "/privacy", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    // Relationship contracts are shared with the desktop from the repository
    // package boundary, so Turbopack must be allowed to trace that package.
    root: path.join(__dirname, "../.."),
  },
};

export default withBundleAnalyzer(nextConfig);
