import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules it actually uses, so the container image stays small and the
  // runtime needs no install step.
  output: "standalone",
  // Booking mutations are all server actions; keep the payload ceiling small.
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
