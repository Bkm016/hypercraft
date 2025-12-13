import type { NextConfig } from "next";

const isStandalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  ...(isStandalone ? { output: "standalone" as const } : {}),
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
};

export default nextConfig;
