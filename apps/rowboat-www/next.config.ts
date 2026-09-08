import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import path from "path";

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

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${plainChat.script}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline' ${plainChat.style}`,
  `img-src 'self' data: blob: ${plainChat.img.join(" ")}`,
  `font-src 'self' data: ${plainChat.style}`,
  `connect-src 'self' https://us.i.posthog.com ${plainChat.connect.join(" ")}`,
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
