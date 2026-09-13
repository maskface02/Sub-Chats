import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // assistant-ui and AI SDK are server-side; keep client bundle lean
  serverExternalPackages: ["better-sqlite3", "pino"],
};

export default nextConfig;
