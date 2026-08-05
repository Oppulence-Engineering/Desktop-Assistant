/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Instant Navigations (Next 16.3): prefetchable loading shells + partial
  // prefetching so dashboard navigations render instantly.
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["awilix"],
};

export default nextConfig;
