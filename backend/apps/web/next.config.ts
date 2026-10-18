import path from "node:path";
import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  serverExternalPackages: ["falkordb", "@neondatabase/serverless"],
  transpilePackages: ["@stackfox/services"],
  async rewrites() {
    return [
      {
        source: "/api-backend/trpc/:path*",
        destination: `${apiUrl}/trpc/:path*`,
      },
      {
        source: "/api-backend/auth/:path*",
        destination: `${apiUrl}/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
