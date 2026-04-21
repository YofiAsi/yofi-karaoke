import type { NextConfig } from "next";

const apiTarget = process.env.API_INTERNAL_URL ?? "http://api:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@karaoke/shared"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
      { source: "/socket.io/:path*", destination: `${apiTarget}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
