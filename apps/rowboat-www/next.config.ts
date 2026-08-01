import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
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
  turbopack: {
    // Relationship contracts are shared with the desktop from the repository
    // package boundary, so Turbopack must be allowed to trace that package.
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
