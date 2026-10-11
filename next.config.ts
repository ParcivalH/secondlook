import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The Speculos emulator's REST API sends no CORS headers; the guardian's browser reaches it through this rewrite.
  async rewrites() {
    return [{ source: "/speculos/:path*", destination: `${process.env.SPECULOS_URL ?? "http://127.0.0.1:5001"}/:path*` }];
  },
  partialPrefetching: true,
};

export default nextConfig;
