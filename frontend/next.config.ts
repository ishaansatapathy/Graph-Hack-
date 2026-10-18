import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [
      // Invite emails and the API's sign-in errors link to the workspace app's routes.
      // Pending invites are claimed automatically when the invited email signs in.
      { source: "/invite/accept", destination: "/signin", permanent: false },
      { source: "/sign-in", destination: "/signin", permanent: false },
    ];
  },
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
