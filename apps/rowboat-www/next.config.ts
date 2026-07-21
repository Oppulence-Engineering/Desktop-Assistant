import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
    // Keep Turbopack scoped to this app instead of inferring a parent workspace root.
    root: __dirname || path.join(process.cwd()),
  },
};

export default nextConfig;
